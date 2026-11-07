//! Loss-preserving interchange only. The native editor does not operate on nodes.
use crate::domain::{self, array, text, MILITARY};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub tag: String,
    pub value: String,
    pub xref: String,
    pub children: Vec<Node>,
}
impl Node {
    pub fn new(tag: &str, value: &str) -> Self {
        Self {
            tag: tag.into(),
            value: value.into(),
            xref: String::new(),
            children: vec![],
        }
    }
    fn first(&self, tag: &str) -> Option<&Node> {
        self.children.iter().find(|n| n.tag == tag)
    }
    fn get(&self, tag: &str) -> &str {
        self.first(tag).map(|n| n.value.as_str()).unwrap_or("")
    }
    fn set(&mut self, tag: &str, value: &str) -> &mut Node {
        let index = self
            .children
            .iter()
            .position(|n| n.tag == tag)
            .unwrap_or_else(|| {
                self.children.push(Node::new(tag, ""));
                self.children.len() - 1
            });
        self.children[index].value = value.into();
        &mut self.children[index]
    }
    fn content(&self) -> String {
        let mut s = self.value.clone();
        for c in &self.children {
            if c.tag == "CONT" {
                s.push('\n');
                s.push_str(&c.content());
            } else if c.tag == "CONC" {
                s.push_str(&c.content());
            }
        }
        s
    }
    fn full(&self, tag: &str) -> String {
        self.first(tag).map(Node::content).unwrap_or_default()
    }
    fn event(&self, tag: &str, key: &str) -> String {
        self.first(tag)
            .map(|n| n.get(key).to_string())
            .unwrap_or_default()
    }
    fn multiline(&mut self, tag: &str, value: &str) {
        let lines = value.split('\n').collect::<Vec<_>>();
        let n = self.set(tag, lines[0]);
        n.children
            .retain(|c| !matches!(c.tag.as_str(), "CONT" | "CONC"));
        for line in &lines[1..] {
            n.children.push(Node::new("CONT", line));
        }
    }
}

fn finish(stack: &mut Vec<Node>, roots: &mut Vec<Node>) {
    let n = stack.pop().unwrap();
    if let Some(parent) = stack.last_mut() {
        parent.children.push(n);
    } else {
        roots.push(n);
    }
}
pub fn parse(input: &str) -> Result<Vec<Node>> {
    let mut roots = vec![];
    let mut stack = Vec::<Node>::new();
    for (number, line) in input.trim_start_matches('\u{feff}').lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let (level, rest) = line
            .split_once(' ')
            .context(format!("Некорректная строка GEDCOM {}", number + 1))?;
        let level: usize = level.parse()?;
        ensure!(
            level <= 128 && level <= stack.len(),
            "Пропущен уровень GEDCOM"
        );
        while stack.len() > level {
            finish(&mut stack, &mut roots);
        }
        let (first, tail) = rest.split_once(' ').unwrap_or((rest, ""));
        let (xref, tag, value) = if first.starts_with('@') {
            let (tag, value) = tail.split_once(' ').unwrap_or((tail, ""));
            (first, tag, value)
        } else {
            ("", first, tail)
        };
        ensure!(
            !tag.is_empty() && tag.chars().all(|c| c.is_alphanumeric() || c == '_'),
            "Некорректный тег GEDCOM"
        );
        ensure!(
            xref.is_empty()
                || (xref.ends_with('@')
                    && xref.len() > 2
                    && !xref[1..xref.len() - 1].contains(['@', ' ', '\t'])),
            "Некорректный ID GEDCOM"
        );
        let mut n = Node::new(tag, value);
        n.xref = xref.into();
        stack.push(n);
    }
    while !stack.is_empty() {
        finish(&mut stack, &mut roots);
    }
    ensure!(
        roots.first().map(|n| n.tag.as_str()) == Some("HEAD")
            && roots.last().map(|n| n.tag.as_str()) == Some("TRLR"),
        "Ожидаются записи HEAD и TRLR"
    );
    let mut ids = std::collections::HashSet::new();
    for n in &roots {
        ensure!(
            n.xref.is_empty() || ids.insert(&n.xref),
            "Повторяющиеся идентификаторы GEDCOM"
        );
    }
    Ok(roots)
}
pub fn serialize(records: &[Node]) -> String {
    fn emit(n: &Node, level: usize, out: &mut String) {
        out.push_str(&format!(
            "{level} {}{}{}\n",
            if n.xref.is_empty() {
                String::new()
            } else {
                format!("{} ", n.xref)
            },
            n.tag,
            if n.value.is_empty() {
                String::new()
            } else {
                format!(" {}", n.value)
            }
        ));
        for c in &n.children {
            emit(c, level + 1, out);
        }
    }
    let mut out = String::new();
    for n in records {
        emit(n, 0, &mut out);
    }
    out
}
fn kind(e: &Node) -> Option<&'static str> {
    if e.tag != "EVEN" {
        return None;
    }
    match e.get("TYPE") {
        "Воинское звание" => Some("militaryRank"),
        "Награда" => Some("awards"),
        "Военная служба" => match e.value.as_str() {
            "Поступление на военную службу" => Some("serviceStart"),
            "Окончание военной службы" => Some("serviceEnd"),
            _ => None,
        },
        _ => None,
    }
}

fn model(records: &[Node]) -> Result<Value> {
    let mut doc = domain::empty();
    doc["extensions"] = serde_json::to_value(records)?;
    for r in records
        .iter()
        .filter(|n| n.tag == "SOUR" && !n.xref.is_empty())
    {
        doc["sources"][&r.xref] = json!({"id":r.xref,"title":r.full("TITL"),"original":r});
    }
    for r in records {
        match r.tag.as_str() {
            "INDI" => {
                let fallback = Node::new("NAME", "");
                let name = r.first("NAME").unwrap_or(&fallback);
                let parts = name.value.split('/').collect::<Vec<_>>();
                let given = if !parts[0].trim().is_empty() {
                    parts[0].trim()
                } else {
                    name.get("GIVN")
                };
                let surname = if !name.get("SURN").is_empty() {
                    name.get("SURN")
                } else {
                    parts.get(1).map(|s| s.trim()).unwrap_or("")
                };
                let mut photos = vec![];
                for c in r
                    .children
                    .iter()
                    .filter(|n| n.tag == "OBJE" && !n.get("FILE").is_empty())
                {
                    if !photos.contains(&json!(c.get("FILE"))) {
                        photos.push(json!(c.get("FILE")));
                    }
                }
                let display = name.value.replace('/', "").trim().to_string();
                let mut p = json!({"id":r.xref,"name":if display.is_empty(){"Имя не указано".to_string()}else{display},"given":given,"surname":surname,"married":name.get("_MARNM"),"sex":r.get("SEX"),"birth":r.event("BIRT","DATE"),"birthPlace":r.event("BIRT","PLAC"),"death":r.event("DEAT","DATE"),"deathPlace":r.event("DEAT","PLAC"),"deceased":r.first("DEAT").is_some(),"note":r.full("NOTE").trim(),"photos":photos,"era":r.get("_ATLAS_ERA"),"names":[],"events":[],"militaryEvidence":[]});
                p["names"] = json!(r
                    .children
                    .iter()
                    .filter(|n| n.tag == "NAME")
                    .map(|n| json!({"text":n.content(),"original":n}))
                    .collect::<Vec<_>>());
                for c in &r.children {
                    if !["NAME", "SEX", "NOTE", "OBJE", "FAMS", "FAMC"].contains(&c.tag.as_str())
                        && (c.first("DATE").is_some()
                            || [
                                "BIRT", "DEAT", "EVEN", "BURI", "RESI", "OCCU", "EDUC", "CHR",
                                "BAPM",
                            ]
                            .contains(&c.tag.as_str()))
                    {
                        let mut e = json!({"type":c.tag,"value":c.value,"date":c.get("DATE"),"place":c.get("PLAC"),"original":c});
                        if let Some(k) = kind(c) {
                            e["kind"] = json!(k);
                        }
                        p["events"].as_array_mut().unwrap().push(e);
                    }
                }
                for key in MILITARY {
                    let events = r
                        .children
                        .iter()
                        .filter(|n| kind(n) == Some(key))
                        .collect::<Vec<_>>();
                    let mut values = vec![];
                    for e in events {
                        let value = if matches!(key, "awards" | "militaryRank") {
                            e.content()
                        } else {
                            e.get("DATE").into()
                        };
                        if !values.contains(&value) {
                            values.push(value);
                        }
                        let citations=e.children.iter().filter(|n|n.tag=="SOUR").map(|n|{
                            let source=records.iter().find(|s|s.tag=="SOUR"&&s.xref==n.value);
                            json!({"id":n.value,"title":source.map(|s|s.full("TITL")).unwrap_or(n.value.clone()),"text":source.map(|s|s.children.iter().filter(|c|c.tag=="NOTE").map(Node::content).collect::<Vec<_>>().join("\n")).unwrap_or_default()})
                        }).collect::<Vec<_>>();
                        p["militaryEvidence"].as_array_mut().unwrap().push(json!({"kind":key,"title":e.content(),"date":e.get("DATE"),"note":e.children.iter().filter(|n|n.tag=="NOTE").map(Node::content).collect::<Vec<_>>().join("\n"),"sources":citations}));
                    }
                    p[key] = json!(values.join("\n"));
                }
                doc["people"][&r.xref] = p;
            }
            "FAM" => {
                doc["families"][&r.xref] = json!({"id":r.xref,"husband":r.get("HUSB"),"wife":r.get("WIFE"),"children":r.children.iter().filter(|n|n.tag=="CHIL").map(|n|n.value.clone()).collect::<Vec<_>>(),"date":r.event("MARR","DATE"),"place":r.event("MARR","PLAC")});
            }
            _ => {}
        }
    }
    domain::validate(&doc)?;
    Ok(doc)
}
pub fn load(text: &str) -> Result<Value> {
    let doc = model(&parse(text)?)?;
    ensure!(
        !doc["people"].as_object().unwrap().is_empty(),
        "В файле нет людей"
    );
    Ok(doc)
}
pub fn validate_archive(doc: &Value) -> Result<()> {
    if !array(doc, "extensions").is_empty() {
        let records: Vec<Node> = serde_json::from_value(doc["extensions"].clone())?;
        let reparsed = parse(&serialize(&records))?;
        ensure!(records == reparsed, "Некорректные архивные расширения");
        model(&records)?;
    }
    Ok(())
}

fn update_military(r: &mut Node, p: &Value, old: &Value) -> Result<()> {
    for key in MILITARY {
        if p[key] == old[key] {
            continue;
        }
        let value = text(p, key);
        if matches!(key, "awards" | "militaryRank") {
            let titles = value
                .lines()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>();
            r.children
                .retain(|e| kind(e) != Some(key) || titles.contains(&e.content().as_str()));
            for title in titles {
                if !r
                    .children
                    .iter()
                    .any(|e| kind(e) == Some(key) && e.content() == title)
                {
                    let mut e = Node::new("EVEN", title);
                    e.children.push(Node::new(
                        "TYPE",
                        if key == "awards" {
                            "Награда"
                        } else {
                            "Воинское звание"
                        },
                    ));
                    r.children.push(e);
                }
            }
        } else {
            if value.is_empty() {
                r.children.retain(|e| kind(e) != Some(key));
                continue;
            }
            let count = r.children.iter().filter(|e| kind(e) == Some(key)).count();
            ensure!(count <= 1, "Несколько периодов службы");
            if let Some(e) = r.children.iter_mut().find(|e| kind(e) == Some(key)) {
                let prev = e.get("DATE").to_string();
                e.set("DATE", value);
                if e.first("SOUR").is_some() {
                    e.children.push(Node::new("NOTE",&format!("Дата изменена пользователем: {prev} → {value}. Прежние источники относятся к исходной дате, новая дата ими не подтверждена.")));
                }
            } else {
                let mut e = Node::new(
                    "EVEN",
                    if key == "serviceStart" {
                        "Поступление на военную службу"
                    } else {
                        "Окончание военной службы"
                    },
                );
                e.children = vec![
                    Node::new("TYPE", "Военная служба"),
                    Node::new("DATE", value),
                ];
                r.children.push(e);
            }
        }
    }
    Ok(())
}
pub fn dump(doc: &Value) -> Result<String> {
    domain::validate(doc)?;
    validate_archive(doc)?;
    let mut records: Vec<Node> = if array(doc, "extensions").is_empty() {
        parse("0 HEAD\n1 CHAR UTF-8\n0 TRLR\n")?
    } else {
        serde_json::from_value(doc["extensions"].clone())?
    };
    let base = model(&records)?;
    records.retain(|r| match r.tag.as_str() {
        "INDI" => doc["people"].get(&r.xref).is_some(),
        "FAM" => doc["families"].get(&r.xref).is_some(),
        _ => true,
    });
    for (id, p) in doc["people"].as_object().unwrap() {
        let old = &base["people"][id];
        if !records.iter().any(|r| r.tag == "INDI" && r.xref == *id) {
            let mut r = Node::new("INDI", "");
            r.xref = id.clone();
            records.insert(records.len() - 1, r);
        }
        let r = records
            .iter_mut()
            .find(|r| r.tag == "INDI" && r.xref == *id)
            .unwrap();
        if old.is_null()
            || ["given", "surname", "married"]
                .iter()
                .any(|k| p[k] != old[k])
        {
            ensure!(
                !text(p, "given").contains('/') && !text(p, "surname").contains('/'),
                "GEDCOM не поддерживает / внутри имени; используйте JSON"
            );
            let n = r.set(
                "NAME",
                &format!("{} /{}/", text(p, "given"), text(p, "surname")),
            );
            n.set("GIVN", text(p, "given"));
            n.set("SURN", text(p, "surname"));
            n.set("_MARNM", text(p, "married"));
        }
        if p["sex"] != old["sex"] {
            r.set("SEX", text(p, "sex"));
        }
        if p["era"] != old["era"] {
            if text(p, "era").is_empty() {
                r.children.retain(|n| n.tag != "_ATLAS_ERA");
            } else {
                r.set("_ATLAS_ERA", text(p, "era"));
            }
        }
        for (tag, date, place) in [
            ("BIRT", "birth", "birthPlace"),
            ("DEAT", "death", "deathPlace"),
        ] {
            if old.is_null()
                || p[date] != old[date]
                || p[place] != old[place]
                || (tag == "DEAT" && p["deceased"] != old["deceased"])
            {
                if tag == "DEAT"
                    && p["deceased"] != true
                    && text(p, date).is_empty()
                    && text(p, place).is_empty()
                {
                    r.children.retain(|n| n.tag != tag);
                } else {
                    if r.first(tag).is_none() {
                        r.children
                            .push(Node::new(tag, if tag == "DEAT" { "Y" } else { "" }));
                    }
                    let e = r.children.iter_mut().find(|n| n.tag == tag).unwrap();
                    e.set("DATE", text(p, date));
                    e.set("PLAC", text(p, place));
                }
            }
        }
        if p["note"] != old["note"] {
            r.multiline("NOTE", text(p, "note"));
        }
        update_military(r, p, old)?;
        r.children.retain(|n| {
            n.tag != "OBJE"
                || n.get("FILE").is_empty()
                || array(p, "photos").iter().any(|v| v == n.get("FILE"))
        });
        for path in array(p, "photos").iter().filter_map(Value::as_str) {
            if !r
                .children
                .iter()
                .any(|n| n.tag == "OBJE" && n.get("FILE") == path)
            {
                let mut n = Node::new("OBJE", "");
                n.children.push(Node::new("FILE", path));
                r.children.push(n);
            }
        }
    }
    for (id, f) in doc["families"].as_object().unwrap() {
        if base["families"].get(id) == Some(f) {
            continue;
        }
        if !records.iter().any(|r| r.tag == "FAM" && r.xref == *id) {
            let mut r = Node::new("FAM", "");
            r.xref = id.clone();
            records.insert(records.len() - 1, r);
        }
        let r = records
            .iter_mut()
            .find(|r| r.tag == "FAM" && r.xref == *id)
            .unwrap();
        for (key, tag) in [("husband", "HUSB"), ("wife", "WIFE")] {
            if r.get(tag) != text(f, key) {
                r.children.retain(|n| n.tag != tag);
                if !text(f, key).is_empty() {
                    r.children.push(Node::new(tag, text(f, key)));
                }
            }
        }
        let prior = r.children.clone();
        r.children.retain(|n| n.tag != "CHIL");
        for child in array(f, "children").iter().filter_map(Value::as_str) {
            r.children.push(
                prior
                    .iter()
                    .find(|n| n.tag == "CHIL" && n.value == child)
                    .cloned()
                    .unwrap_or(Node::new("CHIL", child)),
            );
        }
        let old = &base["families"][id];
        if old.is_null() || f["date"] != old["date"] || f["place"] != old["place"] {
            if r.first("MARR").is_none() {
                r.children.push(Node::new("MARR", "Y"));
            }
            let m = r.children.iter_mut().find(|n| n.tag == "MARR").unwrap();
            m.set("DATE", text(f, "date"));
            m.set("PLAC", text(f, "place"));
        }
    }
    if base["families"] != doc["families"]
        || base["people"]
            .as_object()
            .unwrap()
            .keys()
            .collect::<Vec<_>>()
            != doc["people"]
                .as_object()
                .unwrap()
                .keys()
                .collect::<Vec<_>>()
    {
        for r in records.iter_mut().filter(|r| r.tag == "INDI") {
            let mut desired = vec![];
            for (fid, f) in doc["families"].as_object().unwrap() {
                if f["husband"] == r.xref || f["wife"] == r.xref {
                    desired.push(("FAMS", fid.as_str()));
                }
                if array(f, "children").iter().any(|i| i == &r.xref) {
                    desired.push(("FAMC", fid.as_str()));
                }
            }
            r.children.retain(|n| {
                !matches!(n.tag.as_str(), "FAMS" | "FAMC")
                    || desired.contains(&(n.tag.as_str(), n.value.as_str()))
            });
            for (tag, fid) in desired {
                if !r.children.iter().any(|n| n.tag == tag && n.value == fid) {
                    r.children.push(Node::new(tag, fid));
                }
            }
        }
    }
    for (id, s) in doc["sources"].as_object().unwrap() {
        if !records.iter().any(|r| r.tag == "SOUR" && r.xref == *id) {
            let mut r = if s.get("original").is_some() {
                serde_json::from_value(s["original"].clone())?
            } else {
                Node::new("SOUR", "")
            };
            r.xref = id.clone();
            records.insert(records.len() - 1, r);
        }
        let r = records
            .iter_mut()
            .find(|r| r.tag == "SOUR" && r.xref == *id)
            .unwrap();
        if r.full("TITL") != text(s, "title") {
            r.multiline("TITL", text(s, "title"));
        }
    }
    let out = serialize(&records);
    model(&parse(&out)?)?;
    Ok(out)
}

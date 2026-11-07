use anyhow::{bail, ensure, Context, Result};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

pub const MILITARY: [&str; 4] = ["militaryRank", "awards", "serviceStart", "serviceEnd"];
const FIELDS: [&str; 10] = [
    "given",
    "surname",
    "married",
    "sex",
    "birth",
    "birthPlace",
    "death",
    "deathPlace",
    "note",
    "era",
];
pub fn empty() -> Value {
    json!({"format":"family-atlas","version":1,"people":{},"families":{},"sources":{},"assertions":[],"extensions":[]})
}
pub fn text<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
pub fn array<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}
pub fn revision(doc: &Value) -> Result<String> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(doc)?)))
}
pub fn clean(v: Option<&Value>, multiline: bool) -> Result<String> {
    let s = v
        .and_then(Value::as_str)
        .context("Недопустимое значение поля")?;
    ensure!(
        s.chars().count() <= 20000 && !s.contains('\0'),
        "Недопустимое значение поля"
    );
    ensure!(
        multiline || !s.contains(['\r', '\n']),
        "Перенос строки недопустим в этом поле"
    );
    Ok(s.trim().to_string())
}
fn field(v: &Value, key: &str, multi: bool) -> Result<String> {
    clean(Some(v.get(key).unwrap_or(&Value::Null)), multi)
}
fn input(v: &Value, key: &str, multi: bool) -> Result<String> {
    clean(
        Some(v.get(key).unwrap_or(&Value::String(String::new()))),
        multi,
    )
}

pub fn validate(doc: &Value) -> Result<()> {
    ensure!(
        doc["format"] == "family-atlas" && doc["version"].as_u64() == Some(1),
        "Неизвестный формат или версия JSON"
    );
    for key in ["people", "families", "sources"] {
        for (id, item) in doc[key]
            .as_object()
            .context(format!("Некорректный раздел {key}"))?
        {
            ensure!(
                item.is_object() && item["id"] == *id && !id.is_empty() && id.len() <= 256,
                "Некорректный идентификатор"
            );
        }
    }
    ensure!(
        doc["assertions"].is_array() && doc["extensions"].is_array(),
        "Некорректные утверждения или расширения"
    );
    for p in doc["people"].as_object().unwrap().values() {
        for key in FIELDS.into_iter().chain(MILITARY).chain(["name"]) {
            field(
                p,
                key,
                matches!(
                    key,
                    "note" | "awards" | "militaryRank" | "serviceStart" | "serviceEnd"
                ),
            )?;
        }
        ensure!(
            ["", "M", "F", "U"].contains(&text(p, "sex")) && p["deceased"].is_boolean(),
            "Некорректная карточка человека"
        );
        for key in ["photos", "names", "events", "militaryEvidence"] {
            ensure!(p[key].is_array(), "Некорректный список {key}");
        }
        ensure!(
            array(p, "photos").iter().all(Value::is_string),
            "Некорректная ссылка на фото"
        );
        if let Some(primary) = p.get("portraitPhoto") {
            ensure!(
                primary.is_string() && array(p, "photos").contains(primary),
                "Основной портрет отсутствует среди фотографий человека"
            );
        }
        if let Some(crops) = p.get("photoCrops") {
            let crops = crops
                .as_object()
                .context("Некорректные настройки кадрирования")?;
            for (photo, modes) in crops {
                ensure!(
                    array(p, "photos").iter().any(|v| v == photo),
                    "Кадрирование относится к отсутствующему фото"
                );
                validate_crops(modes)?;
            }
        }
        for e in array(p, "events") {
            ensure!(e.is_object(), "Некорректное событие");
            for key in ["type", "value", "date", "place"] {
                input(e, key, key == "value")?;
            }
        }
        for n in array(p, "names") {
            ensure!(n.is_object(), "Некорректное имя");
            input(n, "text", false)?;
        }
        for e in array(p, "militaryEvidence") {
            ensure!(
                e.is_object() && MILITARY.contains(&text(e, "kind")) && e["sources"].is_array(),
                "Некорректные военные сведения"
            );
            for key in ["title", "date", "note"] {
                input(e, key, key != "date")?;
            }
        }
    }
    for s in doc["sources"].as_object().unwrap().values() {
        input(s, "title", true)?;
    }
    ensure!(
        array(doc, "assertions").iter().all(Value::is_object),
        "Некорректное утверждение"
    );
    let people = doc["people"].as_object().unwrap();
    let mut graph: HashMap<String, Vec<String>> =
        people.keys().map(|id| (id.clone(), vec![])).collect();
    for f in doc["families"].as_object().unwrap().values() {
        for key in ["husband", "wife", "date", "place"] {
            field(f, key, false)?;
        }
        ensure!(
            f["children"].is_array() && array(f, "children").iter().all(Value::is_string),
            "Некорректный список детей"
        );
        let mut members = HashSet::new();
        for id in [text(f, "husband"), text(f, "wife")]
            .into_iter()
            .chain(array(f, "children").iter().map(|v| v.as_str().unwrap()))
            .filter(|s| !s.is_empty())
        {
            ensure!(
                people.contains_key(id),
                "В семье есть ссылка на несуществующего человека"
            );
            ensure!(
                members.insert(id),
                "Человек не может занимать две роли в одной семье"
            );
        }
        for parent in [text(f, "husband"), text(f, "wife")]
            .into_iter()
            .filter(|s| !s.is_empty())
        {
            graph.get_mut(parent).unwrap().extend(
                array(f, "children")
                    .iter()
                    .map(|v| v.as_str().unwrap().to_string()),
            );
        }
    }
    let mut state = HashMap::<String, u8>::new();
    for start in graph.keys() {
        let mut stack = vec![(start.clone(), false)];
        while let Some((id, exit)) = stack.pop() {
            if exit {
                state.insert(id, 2);
                continue;
            }
            match state.get(&id) {
                Some(1) => bail!("Циклическая связь: человек не может быть собственным предком"),
                Some(2) => continue,
                _ => {}
            }
            state.insert(id.clone(), 1);
            stack.push((id.clone(), true));
            for child in &graph[&id] {
                stack.push((child.clone(), false));
            }
        }
    }
    Ok(())
}

fn identifier(doc: &Value, prefix: &str) -> String {
    (1..)
        .map(|i| format!("@{prefix}{i}@"))
        .find(|id| {
            ["people", "families", "sources"]
                .iter()
                .all(|k| doc[k].get(id).is_none())
                && !array(doc, "extensions")
                    .iter()
                    .any(|record| text(record, "xref") == id)
        })
        .unwrap()
}

fn refresh(p: &mut Value) {
    let primary =
        json!({"text":p["name"],"given":p["given"],"surname":p["surname"],"married":p["married"]});
    let names = p["names"].as_array_mut().unwrap();
    if names.is_empty() {
        names.push(primary);
    } else {
        names[0]
            .as_object_mut()
            .unwrap()
            .extend(primary.as_object().unwrap().clone());
    }
    for (tag, date, place, present) in [
        ("BIRT", p["birth"].clone(), p["birthPlace"].clone(), true),
        (
            "DEAT",
            p["death"].clone(),
            p["deathPlace"].clone(),
            p["deceased"] == true,
        ),
    ] {
        let events = p["events"].as_array_mut().unwrap();
        if !present {
            events.retain(|e| e["type"] != tag);
        } else if let Some(e) = events.iter_mut().find(|e| e["type"] == tag) {
            e["date"] = date;
            e["place"] = place;
        } else {
            events.push(json!({"type":tag,"value":"","date":date,"place":place}));
        }
    }
    let prior = array(p, "events").to_vec();
    let evidence = array(p, "militaryEvidence").to_vec();
    let events = p["events"].as_array_mut().unwrap();
    events.retain(|e| !MILITARY.contains(&text(e, "kind")));
    for e in evidence {
        let mut event = prior
            .iter()
            .find(|old| old["kind"] == e["kind"] && old["value"] == e["title"])
            .cloned()
            .unwrap_or(json!({}));
        for (to, from) in [
            ("kind", "kind"),
            ("value", "title"),
            ("date", "date"),
            ("note", "note"),
            ("sources", "sources"),
        ] {
            event[to] = e[from].clone();
        }
        event["type"] = json!("EVEN");
        events.push(event);
    }
}

fn military(p: &mut Value, values: &Value) -> Result<()> {
    for key in MILITARY {
        if values.get(key).is_none() {
            continue;
        }
        if values[key] == p[key] {
            continue;
        }
        let mut value = input(values, key, matches!(key, "awards" | "militaryRank"))?;
        let old = array(p, "militaryEvidence")
            .iter()
            .filter(|e| e["kind"] == key)
            .cloned()
            .collect::<Vec<_>>();
        let events = p["militaryEvidence"].as_array_mut().unwrap();
        if matches!(key, "awards" | "militaryRank") {
            let mut titles = Vec::<String>::new();
            for title in value.lines().map(str::trim).filter(|s| !s.is_empty()) {
                if !titles.iter().any(|s| s == title) {
                    titles.push(title.to_string());
                }
            }
            events.retain(|e| e["kind"] != key || titles.iter().any(|t| e["title"] == *t));
            for title in &titles {
                if !old.iter().any(|e| e["title"] == *title) {
                    events.push(json!({"kind":key,"title":title,"date":"","note":"","sources":[]}));
                }
            }
            value = titles.join("\n");
        } else {
            ensure!(
                old.len() <= 1,
                "Несколько периодов службы: требуется отдельное уточнение событий"
            );
            if value.is_empty() {
                events.retain(|e| e["kind"] != key);
            } else if let Some(e) = events.iter_mut().find(|e| e["kind"] == key) {
                if !array(e, "sources").is_empty() {
                    e["note"]=json!(format!("{}{}Дата изменена пользователем: {} → {}. Прежние источники относятся к исходной дате, новая дата ими не подтверждена.",text(e,"note"),if text(e,"note").is_empty(){""}else{"\n"},text(e,"date"),value));
                }
                e["date"] = json!(value);
            } else {
                events.push(json!({"kind":key,"title":if key=="serviceStart"{"Поступление на военную службу"}else{"Окончание военной службы"},"date":value,"note":"","sources":[]}));
            }
        }
        p[key] = json!(value);
    }
    Ok(())
}

pub fn edit(document: &Value, action: &Value) -> Result<(Value, String)> {
    let mut doc = document.clone();
    let kind = text(action, "type");
    let mut id = text(action, "id").to_string();
    let values = action.get("values").cloned().unwrap_or(json!({}));
    ensure!(values.is_object(), "Ожидается объект полей");
    match kind {
        "addRelative" => {
            let p = doc["people"].get(&id).context("Человек не найден")?.clone();
            let role = text(&values, "relationship");
            ensure!(
                ["child", "husband", "wife"].contains(&role),
                "Неизвестный вид родства"
            );
            let mut relative = text(&values, "personId").to_string();
            if relative.is_empty() {
                let pv = &values["person"];
                ensure!(
                    pv.is_object() && !input(pv, "given", false)?.is_empty(),
                    "Укажите имя нового родственника"
                );
                (doc, relative) = edit(&doc, &json!({"type":"person","values":pv}))?;
            } else {
                ensure!(
                    doc["people"].get(&relative).is_some(),
                    "Родственник не найден"
                );
            }
            ensure!(
                relative != id,
                "Нельзя добавить человека родственником самому себе"
            );
            let fid = text(&values, "familyId");
            let mut f = if !fid.is_empty() {
                let f = doc["families"]
                    .get(fid)
                    .context("Семья не найдена")?
                    .clone();
                ensure!(
                    f["husband"] == id || f["wife"] == id,
                    "Выберите собственную семью этого человека"
                );
                f
            } else {
                let mut f = json!({"husband":"","wife":"","children":[],"date":"","place":""});
                let own = if role == "child" {
                    if p["sex"] == "F" {
                        "wife"
                    } else {
                        "husband"
                    }
                } else if role == "husband" {
                    "wife"
                } else {
                    "husband"
                };
                f[own] = json!(id);
                f
            };
            if role == "child" {
                ensure!(
                    !array(&f, "children").iter().any(|v| v == &relative),
                    "Этот ребёнок уже есть в семье"
                );
                f["children"].as_array_mut().unwrap().push(json!(relative));
            } else {
                ensure!(text(&f, role).is_empty(), "Эта роль в семье уже занята");
                f[role] = json!(relative);
            }
            (doc, _) = edit(&doc, &json!({"type":"family","id":fid,"values":f}))?;
        }
        "person" => {
            if id.is_empty() {
                id = identifier(&doc, "I");
            } else {
                ensure!(doc["people"].get(&id).is_some(), "Запись не найдена");
            }
            let mut p=doc["people"].get(&id).cloned().unwrap_or(json!({"id":id,"photos":[],"names":[],"events":[],"militaryEvidence":[],"era":"","militaryRank":"","awards":"","serviceStart":"","serviceEnd":""}));
            for key in FIELDS.into_iter().filter(|k| *k != "era") {
                p[key] = json!(input(&values, key, key == "note")?);
            }
            p["deceased"] = json!(
                values["deceased"] == true
                    || !text(&p, "death").is_empty()
                    || !text(&p, "deathPlace").is_empty()
            );
            let name = [text(&p, "given"), text(&p, "surname")]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            p["name"] = json!(if name.is_empty() {
                "Имя не указано".to_string()
            } else {
                name
            });
            if values.get("era").is_some() {
                ensure!(
                    [
                        "",
                        "imperial",
                        "early-ussr",
                        "late-ussr",
                        "young-russia",
                        "modern-russia"
                    ]
                    .contains(&text(&values, "era")),
                    "Неизвестная эпоха оформления"
                );
                p["era"] = values["era"].clone();
            }
            military(&mut p, &values)?;
            refresh(&mut p);
            doc["people"][&id] = p;
        }
        "family" => {
            if id.is_empty() {
                id = identifier(&doc, "F");
            } else {
                ensure!(doc["families"].get(&id).is_some(), "Запись не найдена");
            }
            let mut f = doc["families"]
                .get(&id)
                .cloned()
                .unwrap_or(json!({"id":id}));
            for key in ["husband", "wife", "date", "place"] {
                f[key] = json!(input(&values, key, false)?);
            }
            f["children"] = values.get("children").cloned().unwrap_or(json!([]));
            doc["families"][&id] = f;
        }
        "deletePerson" | "deleteFamily" => {
            let collection = if kind == "deletePerson" {
                "people"
            } else {
                "families"
            };
            ensure!(
                doc[collection]
                    .as_object_mut()
                    .unwrap()
                    .remove(&id)
                    .is_some(),
                "Запись не найдена"
            );
            if kind == "deletePerson" {
                for f in doc["families"].as_object_mut().unwrap().values_mut() {
                    for role in ["husband", "wife"] {
                        if f[role] == id {
                            f[role] = json!("");
                        }
                    }
                    f["children"].as_array_mut().unwrap().retain(|c| c != &id);
                }
            }
        }
        "cropPhoto" => {
            let p = doc["people"].get_mut(&id).context("Человек не найден")?;
            let photo = input(&values, "photo", false)?;
            ensure!(
                array(p, "photos").iter().any(|v| v == &photo),
                "Фотография не принадлежит этому человеку"
            );
            let crops = values
                .get("crops")
                .context("Ожидаются настройки кадрирования")?;
            validate_crops(crops)?;
            if p.get("photoCrops").is_none() {
                p["photoCrops"] = json!({});
            }
            if crops.as_object().unwrap().is_empty() {
                p["photoCrops"].as_object_mut().unwrap().remove(&photo);
            } else {
                p["photoCrops"][&photo] = crops.clone();
            }
            if let Some(primary) = values.get("primary") {
                ensure!(
                    primary.is_boolean(),
                    "Некорректный выбор основного портрета"
                );
                if primary == true {
                    p["portraitPhoto"] = json!(photo);
                }
            }
        }
        "addPhoto" => {
            let p = doc["people"].get_mut(&id).context("Человек не найден")?;
            let filename = text(&values, "filename");
            ensure!(
                valid_photo_name(filename) && filename.split('.').next().unwrap().len() == 64,
                "Некорректное имя фотографии"
            );
            let path = json!(format!("photos/{filename}"));
            let photos = p["photos"].as_array_mut().unwrap();
            if !photos.contains(&path) {
                photos.push(path);
            }
        }
        _ => bail!("Неизвестная операция"),
    }
    validate(&doc)?;
    Ok((doc, id))
}

fn validate_crops(modes: &Value) -> Result<()> {
    let modes = modes
        .as_object()
        .context("Ожидается объект рамок кадрирования")?;
    for (mode, rect) in modes {
        ensure!(
            ["tree", "poster", "posterPair"].contains(&mode.as_str()),
            "Неизвестная рамка кадрирования"
        );
        let rect = rect
            .as_object()
            .context("Некорректная область кадрирования")?;
        ensure!(
            rect.len() == 4,
            "Область кадрирования должна содержать x, y, width, height"
        );
        let number = |key: &str| -> Result<f64> {
            let n = rect
                .get(key)
                .and_then(Value::as_f64)
                .context("Некорректные координаты кадрирования")?;
            ensure!(n.is_finite(), "Некорректные координаты кадрирования");
            Ok(n)
        };
        let (x, y, w, h) = (
            number("x")?,
            number("y")?,
            number("width")?,
            number("height")?,
        );
        ensure!(
            x >= 0.
                && y >= 0.
                && w > 0.
                && h > 0.
                && w <= 1.
                && h <= 1.
                && x + w <= 1. + 1e-9
                && y + h <= 1. + 1e-9,
            "Область кадрирования выходит за границы фотографии"
        );
    }
    Ok(())
}

pub fn valid_photo_name(name: &str) -> bool {
    let Some((hash, ext)) = name.rsplit_once('.') else {
        return false;
    };
    (20..=64).contains(&hash.len())
        && hash
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        && ["jpg", "png", "gif", "webp"].contains(&ext)
}
pub fn image_type(bytes: &[u8]) -> Result<&'static str> {
    if bytes.starts_with(&[255, 216, 255]) {
        Ok("jpg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("png")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok("gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Ok("webp")
    } else {
        bail!("Поддерживаются только растровые JPG, PNG, GIF и WebP")
    }
}

use crate::{
    domain::{self, array, text},
    gedcom,
};
use anyhow::{ensure, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use rusqlite::{params, Connection, OpenFlags, TransactionBehavior};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};

pub struct Store {
    pub directory: PathBuf,
}

/// Explicit read-only compatibility check, not a CRUD test on personal data.
pub fn verify_project(root: &Path) -> Result<Value> {
    let path = if root.join("family.sqlite").is_file() {
        root.join("family.sqlite")
    } else {
        root.join("data/family.sqlite")
    };
    let mut db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let tx = db.transaction()?;
    let doc = read(&tx)?;
    let integrity: String = tx.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    ensure!(integrity == "ok", "Ошибка целостности SQLite");
    ensure!(
        !tx.prepare("PRAGMA foreign_key_check")?
            .query([])?
            .next()?
            .is_some(),
        "Ошибка внешних ключей SQLite"
    );
    let export = gedcom::dump(&doc)?;
    let roundtrip = gedcom::load(&export)?;
    ensure!(
        doc["families"] == roundtrip["families"],
        "Потеря семей при GEDCOM-экспорте"
    );
    let archival_nodes_unchanged =
        serde_json::to_value(gedcom::parse(&export)?)? == doc["extensions"];
    let media = Store {
        directory: root.to_path_buf(),
    }
    .media()?;
    Ok(
        json!({"revision":domain::revision(&doc)?,"people":doc["people"].as_object().unwrap().len(),"families":doc["families"].as_object().unwrap().len(),"sources":doc["sources"].as_object().unwrap().len(),"localPhotos":array(&media,"local").len(),"archivalNodesUnchanged":archival_nodes_unchanged,"integrity":integrity,"schemaVersion":1}),
    )
}
fn encoded(v: &Value) -> Result<String> {
    Ok(serde_json::to_string(v)?)
}
fn connect(path: &Path) -> Result<Connection> {
    let db = Connection::open(path)?;
    db.busy_timeout(Duration::from_secs(30))?;
    db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
    Ok(db)
}
fn timestamp() -> String {
    Utc::now().format("%Y%m%d-%H%M%S-%f").to_string()
}

pub fn read(db: &Connection) -> Result<Value> {
    ensure!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))? == 1,
        "Неподдерживаемая версия SQLite"
    );
    let raw: String = db.query_row("SELECT value FROM metadata WHERE key='document'", [], |r| {
        r.get(0)
    })?;
    let mut doc: Value = serde_json::from_str(&raw)?;
    for table in ["people", "families", "sources"] {
        doc[table] = json!({});
        let mut stmt = db.prepare(&format!("SELECT id,payload FROM {table} ORDER BY position"))?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (id, payload) = row?;
            doc[table][&id] = serde_json::from_str(&payload)?;
        }
    }
    for p in doc["people"]
        .as_object_mut()
        .context("Некорректная таблица людей")?
        .values_mut()
    {
        for k in ["names", "events", "photos"] {
            p[k] = json!([]);
        }
    }
    for table in ["names", "events", "media"] {
        let column = if table == "media" { "path" } else { "payload" };
        let key = if table == "media" { "photos" } else { table };
        let mut stmt = db.prepare(&format!(
            "SELECT person_id,{column} FROM {table} ORDER BY position"
        ))?;
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (pid, payload) = row?;
            doc["people"][&pid][key]
                .as_array_mut()
                .context("Отсутствует владелец записи")?
                .push(if table == "media" {
                    json!(payload)
                } else {
                    serde_json::from_str(&payload)?
                });
        }
    }
    for f in doc["families"]
        .as_object_mut()
        .context("Некорректная таблица семей")?
        .values_mut()
    {
        f["husband"] = json!("");
        f["wife"] = json!("");
        f["children"] = json!([]);
    }
    let mut stmt =
        db.prepare("SELECT family_id,person_id,role FROM family_members ORDER BY position")?;
    for row in stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
        ))
    })? {
        let (fid, pid, role) = row?;
        if role == "child" {
            doc["families"][&fid]["children"]
                .as_array_mut()
                .context("Отсутствует семья")?
                .push(json!(pid));
        } else {
            doc["families"][&fid][&role] = json!(pid);
        }
    }
    for table in ["assertions", "extensions"] {
        let mut stmt = db.prepare(&format!("SELECT payload FROM {table} ORDER BY position"))?;
        let mut list = vec![];
        for raw in stmt.query_map([], |r| r.get::<_, String>(0))? {
            list.push(serde_json::from_str::<Value>(&raw?)?);
        }
        doc[table] = json!(list);
    }
    domain::validate(&doc)?;
    let saved: String =
        db.query_row("SELECT value FROM metadata WHERE key='revision'", [], |r| {
            r.get(0)
        })?;
    ensure!(
        domain::revision(&doc)? == saved,
        "Контрольная сумма базы не совпадает; восстановите резервную копию"
    );
    Ok(doc)
}
fn write(db: &Connection, doc: &Value, action: &str, previous: Option<&str>) -> Result<()> {
    domain::validate(doc)?;
    for table in [
        "family_members",
        "names",
        "events",
        "media",
        "families",
        "people",
        "sources",
        "assertions",
        "extensions",
    ] {
        db.execute(&format!("DELETE FROM {table}"), [])?;
    }
    for table in ["people", "families", "sources"] {
        for (pos, (id, item)) in doc[table].as_object().unwrap().iter().enumerate() {
            let mut payload = item.clone();
            let excluded: &[&str] = match table {
                "people" => &["names", "events", "photos"],
                "families" => &["husband", "wife", "children"],
                _ => &[],
            };
            for key in excluded {
                payload.as_object_mut().unwrap().remove(*key);
            }
            db.execute(
                &format!("INSERT INTO {table} VALUES(?,?,?)"),
                params![id, pos as i64, encoded(&payload)?],
            )?;
        }
    }
    for (pid, p) in doc["people"].as_object().unwrap() {
        for table in ["names", "events"] {
            for (i, v) in array(p, table).iter().enumerate() {
                db.execute(
                    &format!("INSERT INTO {table} VALUES(?,?,?)"),
                    params![pid, i as i64, encoded(v)?],
                )?;
            }
        }
        for (i, v) in array(p, "photos").iter().enumerate() {
            db.execute(
                "INSERT INTO media VALUES(?,?,?)",
                params![pid, i as i64, v.as_str()],
            )?;
        }
    }
    for (fid, f) in doc["families"].as_object().unwrap() {
        for role in ["husband", "wife"] {
            if !text(f, role).is_empty() {
                db.execute(
                    "INSERT INTO family_members VALUES(?,?,?,?)",
                    params![fid, text(f, role), role, 0],
                )?;
            }
        }
        for (i, pid) in array(f, "children").iter().enumerate() {
            db.execute(
                "INSERT INTO family_members VALUES(?,?,?,?)",
                params![fid, pid.as_str(), "child", i as i64],
            )?;
        }
    }
    for table in ["assertions", "extensions"] {
        for (i, v) in array(doc, table).iter().enumerate() {
            db.execute(
                &format!("INSERT INTO {table} VALUES(?,?)"),
                params![i as i64, encoded(v)?],
            )?;
        }
    }
    let mut remainder = doc.clone();
    for k in ["people", "families", "sources", "assertions", "extensions"] {
        remainder.as_object_mut().unwrap().remove(k);
    }
    let rev = domain::revision(doc)?;
    for (key, value) in [
        ("document", encoded(&remainder)?),
        ("revision", rev.clone()),
    ] {
        db.execute(
            "INSERT OR REPLACE INTO metadata VALUES(?,?)",
            params![key, value],
        )?;
    }
    db.execute(
        "INSERT INTO history(timestamp,action,previous_revision,revision) VALUES(?,?,?,?)",
        params![Utc::now().to_rfc3339(), action, previous, rev],
    )?;
    Ok(())
}
pub fn history(db: &Connection) -> Result<Vec<Value>> {
    let mut stmt = db.prepare(
        "SELECT timestamp,action,previous_revision,revision FROM history ORDER BY sequence",
    )?;
    let mut result = vec![];
    for row in stmt.query_map([],|r|Ok(json!({"timestamp":r.get::<_,String>(0)?,"action":r.get::<_,String>(1)?,"previousRevision":r.get::<_,Option<String>>(2)?,"revision":r.get::<_,String>(3)?})))?{result.push(row?);}
    Ok(result)
}
fn import_history(db: &Connection, rows: &[Value]) -> Result<()> {
    for r in rows {
        for k in ["timestamp", "action", "revision"] {
            ensure!(r[k].is_string(), "Некорректная история JSON");
        }
        ensure!(
            r["previousRevision"].is_null() || r["previousRevision"].is_string(),
            "Некорректная история JSON"
        );
        let label = if text(r, "action").starts_with("imported:") {
            text(r, "action").to_string()
        } else {
            format!("imported:{}", text(r, "action"))
        };
        let previous = r["previousRevision"].as_str();
        let exists:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM history WHERE timestamp=? AND action=? AND previous_revision IS ? AND revision=?)",params![text(r,"timestamp"),label,previous,text(r,"revision")],|r|r.get(0))?;
        if !exists {
            db.execute(
                "INSERT INTO history(timestamp,action,previous_revision,revision) VALUES(?,?,?,?)",
                params![text(r, "timestamp"), label, previous, text(r, "revision")],
            )?;
        }
    }
    Ok(())
}

impl Store {
    pub fn new(directory: PathBuf) -> Result<Self> {
        fs::create_dir_all(&directory)?;
        let store = Self { directory };
        let mut db = connect(&store.path())?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let version: i64 = tx.pragma_query_value(None, "user_version", |r| r.get(0))?;
        ensure!([0, 1].contains(&version), "Неподдерживаемая версия SQLite");
        tx.execute_batch(include_str!("schema.sql"))?;
        tx.pragma_update(None, "user_version", 1)?;
        let initialized: bool =
            tx.query_row("SELECT EXISTS(SELECT 1 FROM metadata)", [], |r| r.get(0))?;
        if !initialized {
            write(&tx, &domain::empty(), "create", None)?;
        } else {
            read(&tx)?;
        }
        tx.commit()?;
        Ok(store)
    }
    pub fn path(&self) -> PathBuf {
        self.directory.join("family.sqlite")
    }
    pub fn document(&self) -> Result<Value> {
        let mut db = connect(&self.path())?;
        let tx = db.transaction()?;
        read(&tx)
    }
    pub fn snapshot(&self) -> Result<Value> {
        let doc = self.document()?;
        snapshot(&doc, None)
    }
    fn backup(&self) -> Result<PathBuf> {
        let folder = self.directory.join("backups");
        fs::create_dir_all(&folder)?;
        let path = folder.join(format!("{}.sqlite", timestamp()));
        let source = connect(&self.path())?;
        source.backup("main", &path, None)?;
        Ok(path)
    }
    fn save_document(
        &self,
        doc: &Value,
        expected: &str,
        action: &str,
        imported: &[Value],
    ) -> Result<Value> {
        domain::validate(doc)?;
        let mut db = connect(&self.path())?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = read(&tx)?;
        ensure!(
            domain::revision(&current)? == expected,
            "Данные изменились в другом окне. Обновите дерево перед сохранением."
        );
        self.backup()?;
        write(&tx, doc, action, Some(expected))?;
        import_history(&tx, imported)?;
        ensure!(read(&tx)? == *doc, "Проверка сохранения не пройдена");
        tx.commit()?;
        snapshot(doc, None)
    }
    pub fn apply(&self, action: &Value) -> Result<Value> {
        let old = self.document()?;
        let expected = text(action, "revision");
        ensure!(
            domain::revision(&old)? == expected,
            "Данные изменились в другом окне. Обновите дерево перед сохранением."
        );
        let kind = text(action, "type");
        if kind == "import" {
            return self.import_text(text(action, "text"), expected);
        }
        ensure!(kind != "addPhoto", "Используйте загрузку фотографии");
        let (doc, id) = if kind == "uploadPhoto" {
            let bytes = STANDARD.decode(text(&action["values"], "data"))?;
            ensure!(
                !bytes.is_empty() && bytes.len() <= 5_000_000,
                "Размер фотографии должен быть от 1 байта до 5 МБ"
            );
            let name = format!(
                "{:x}.{}",
                Sha256::digest(&bytes),
                domain::image_type(&bytes)?
            );
            let result = domain::edit(
                &old,
                &json!({"type":"addPhoto","id":action["id"],"values":{"filename":name}}),
            )?;
            let folder = self.directory.join("photos");
            fs::create_dir_all(&folder)?;
            let path = folder.join(&name);
            if !path.exists() {
                use std::io::Write;
                let mut file = fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&path)?;
                file.write_all(&bytes)?;
                file.sync_all()?;
            }
            result
        } else {
            domain::edit(&old, action)?
        };
        let mut result = self.save_document(&doc, expected, kind, &[])?;
        result["editedId"] = json!(id);
        Ok(result)
    }
    pub fn import_text(&self, input: &str, expected: &str) -> Result<Value> {
        ensure!(
            input.len() <= 10_000_000,
            "Максимальный размер импорта: 10 МБ"
        );
        let input = input.trim_start_matches('\u{feff}');
        let mut doc = if input.trim_start().starts_with('{') {
            serde_json::from_str(input)?
        } else {
            gedcom::load(input)?
        };
        let rows = doc
            .as_object_mut()
            .context("Ожидается JSON-объект")?
            .remove("changeHistory")
            .unwrap_or(json!([]));
        ensure!(rows.is_array(), "Некорректная история JSON");
        domain::validate(&doc)?;
        gedcom::validate_archive(&doc)?;
        self.save_document(&doc, expected, "import", rows.as_array().unwrap())
    }
    pub fn export_json(&self) -> Result<String> {
        let mut db = connect(&self.path())?;
        let tx = db.transaction()?;
        let mut doc = read(&tx)?;
        doc["changeHistory"] = json!(history(&tx)?);
        Ok(serde_json::to_string_pretty(&doc)? + "\n")
    }
    pub fn export_gedcom(&self) -> Result<String> {
        gedcom::dump(&self.document()?)
    }
    pub fn media(&self) -> Result<Value> {
        let folder = self.directory.join("photos");
        let mut result = json!({"files":{},"errors":{},"local":[],"embedded":{}});
        if folder.join("manifest.json").is_file() {
            let m: Value = serde_json::from_slice(&fs::read(folder.join("manifest.json"))?)?;
            result["files"] = m
                .get("files")
                .filter(|v| v.is_object())
                .cloned()
                .unwrap_or(json!({}));
            result["errors"] = m.get("errors").cloned().unwrap_or(json!({}));
        }
        if folder.exists() {
            for entry in fs::read_dir(&folder)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                if domain::valid_photo_name(&name) {
                    let path = entry.path().canonicalize()?;
                    ensure!(
                        path.parent() == Some(folder.canonicalize()?.as_path()),
                        "Символические ссылки фотографий запрещены"
                    );
                    let meta = fs::metadata(&path)?;
                    if !meta.is_file() || meta.len() > 20_000_000 {
                        continue;
                    }
                    let bytes = fs::read(path)?;
                    let Ok(ext) = domain::image_type(&bytes) else {
                        continue;
                    };
                    let mime = if ext == "jpg" { "jpeg" } else { ext };
                    result["local"].as_array_mut().unwrap().push(json!(name));
                    result["embedded"][format!("/photos/{name}")] = json!(format!(
                        "data:image/{mime};base64,{}",
                        STANDARD.encode(bytes)
                    ));
                }
            }
        }
        Ok(result)
    }
    pub fn import_project(&self, root: &Path, expected: &str) -> Result<Value> {
        let db_path = if root.join("family.sqlite").is_file() {
            root.join("family.sqlite")
        } else {
            root.join("data/family.sqlite")
        };
        ensure!(
            db_path.canonicalize()? != self.path().canonicalize()?,
            "Нельзя импортировать активную базу в саму себя"
        );
        let mut source = Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let tx = source.transaction()?;
        let doc = read(&tx)?;
        let ledger = history(&tx)?;
        let photos = root.join("photos");
        let target = self.directory.join("photos");
        fs::create_dir_all(&target)?;
        if photos.exists() {
            for entry in fs::read_dir(&photos)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                if name != "manifest.json" && !domain::valid_photo_name(&name) {
                    continue;
                }
                ensure!(
                    !entry.file_type()?.is_symlink(),
                    "Символические ссылки фотографий запрещены"
                );
                let bytes = fs::read(entry.path())?;
                ensure!(bytes.len() <= 20_000_000, "Слишком большой файл фотографии");
                if name != "manifest.json" {
                    domain::image_type(&bytes)?;
                }
                let dest = target.join(&name);
                if dest.exists() {
                    ensure!(
                        fs::read(&dest)? == bytes,
                        "Конфликт файла {name}; используйте отдельный каталог данных"
                    );
                } else {
                    use std::io::Write;
                    let mut f = fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(dest)?;
                    f.write_all(&bytes)?;
                    f.sync_all()?;
                }
            }
        }
        self.save_document(&doc, expected, "importProject", &ledger)
    }
    pub fn export_project(&self, parent: &Path) -> Result<PathBuf> {
        let output = parent.join(format!("family-atlas-{}", timestamp()));
        fs::create_dir(&output)?;
        let source = connect(&self.path())?;
        source.backup("main", output.join("family.sqlite"), None)?;
        // JSON is produced from the consistent backup, not a later live revision.
        let copy = Self {
            directory: output.clone(),
        };
        fs::write(output.join("family-tree.json"), copy.export_json()?)?;
        let photos = self.directory.join("photos");
        if photos.exists() {
            fs::create_dir(output.join("photos"))?;
            for entry in fs::read_dir(&photos)? {
                let entry = entry?;
                let name = entry.file_name();
                if entry.file_type()?.is_file() && !entry.file_type()?.is_symlink() {
                    fs::copy(entry.path(), output.join("photos").join(name))?;
                }
            }
        }
        Ok(output)
    }
}
pub fn snapshot(doc: &Value, id: Option<&str>) -> Result<Value> {
    Ok(
        json!({"people":doc["people"],"families":doc["families"],"revision":domain::revision(doc)?,"saved":true,"storage":"sqlite","schemaVersion":1,"editedId":id}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crud_conflicts_and_backups() {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::new(dir.path().into()).unwrap();
        let rev = s.snapshot().unwrap()["revision"].clone();
        let added=s.apply(&json!({"type":"person","revision":rev,"values":{"given":"Тест / Имя","birth":"21 MAR 19"}})).unwrap();
        assert_eq!(added["people"].as_object().unwrap().len(), 1);
        assert!(s
            .apply(&json!({"type":"person","revision":rev,"values":{"given":"stale"}}))
            .is_err());
        assert_eq!(
            s.document().unwrap()["people"][added["editedId"].as_str().unwrap()]["birth"],
            "21 MAR 19"
        );
        assert!(fs::read_dir(s.directory.join("backups"))
            .unwrap()
            .next()
            .is_some());
        assert_eq!(
            Store::new(dir.path().into()).unwrap().snapshot().unwrap()["revision"],
            added["revision"]
        );
    }
    #[test]
    fn json_preserves_extras_and_history() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let s = Store::new(a.path().into()).unwrap();
        let t = Store::new(b.path().into()).unwrap();
        let mut doc = domain::empty();
        doc["assertions"] = json!([{"value":"contradictory"}]);
        doc["custom"] = json!({"keep":"кириллица"});
        s.import_text(
            &encoded(&doc).unwrap(),
            s.snapshot().unwrap()["revision"].as_str().unwrap(),
        )
        .unwrap();
        t.import_text(
            &s.export_json().unwrap(),
            t.snapshot().unwrap()["revision"].as_str().unwrap(),
        )
        .unwrap();
        assert_eq!(s.document().unwrap(), t.document().unwrap());
        assert!(t.export_json().unwrap().contains("imported:"));
    }
    #[test]
    fn invalid_relative_is_atomic() {
        let dir = tempfile::tempdir().unwrap();
        let s = Store::new(dir.path().into()).unwrap();
        let before = s.snapshot().unwrap();
        assert!(s.apply(&json!({"type":"addRelative","id":"missing","revision":before["revision"],"values":{"relationship":"child","person":{"given":"Test"}}})).is_err());
        assert_eq!(s.snapshot().unwrap(), before);
    }
    #[test]
    fn native_gedcom_roundtrip() {
        let text="0 HEAD\n1 CHAR UTF-8\n0 @S1@ SOUR\n1 TITL Документ\n0 @I1@ INDI\n1 NAME Имя /Фамилия/\n1 EVEN Медаль\n2 TYPE Награда\n2 SOUR @S1@\n3 PAGE 42\n1 _CUSTOM keep\n0 TRLR\n";
        let doc = gedcom::load(text).unwrap();
        assert_eq!(
            gedcom::parse(&gedcom::dump(&doc).unwrap()).unwrap(),
            gedcom::parse(text).unwrap()
        );
        let (updated,_)=domain::edit(&doc,&json!({"type":"person","id":"@I1@","values":{"given":"Новое","awards":"Медаль\nНовая"}})).unwrap();
        let export = gedcom::dump(&updated).unwrap();
        assert!(export.contains("3 PAGE 42"));
        assert!(export.contains("1 _CUSTOM keep"));
        assert_eq!(
            updated["people"]["@I1@"]["militaryEvidence"][1]["sources"],
            json!([])
        );
    }
    #[test]
    fn parent_cycle_rejected() {
        let (mut doc, a) = domain::edit(
            &domain::empty(),
            &json!({"type":"person","values":{"given":"A"}}),
        )
        .unwrap();
        let (next, b) =
            domain::edit(&doc, &json!({"type":"person","values":{"given":"B"}})).unwrap();
        doc = next;
        let (doc, _) = domain::edit(
            &doc,
            &json!({"type":"family","values":{"husband":a,"children":[b]}}),
        )
        .unwrap();
        assert!(domain::edit(
            &doc,
            &json!({"type":"family","values":{"husband":b,"children":[a]}})
        )
        .is_err());
    }
    #[test]
    fn image_and_path_validation() {
        assert!(!domain::valid_photo_name("../tree.sqlite"));
        assert!(domain::image_type(b"<svg/>").is_err());
        assert_eq!(domain::image_type(b"\x89PNG\r\n\x1a\nrest").unwrap(), "png");
    }
}

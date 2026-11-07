//! Synthetic regression suite. Never opens working family databases.
use crate::{
    domain, gedcom,
    store::{self, Store},
};
use serde_json::{json, Value};
use std::{
    fs,
    sync::{Arc, Barrier},
};

#[test]
fn deleted_archival_ids_are_not_reused_for_another_person() {
    let doc =
        gedcom::load("0 HEAD\n0 @I1@ INDI\n1 NAME Старый человек\n1 _CLAIM original\n0 TRLR\n")
            .unwrap();
    let (doc, _) = domain::edit(&doc, &json!({"type":"deletePerson","id":"@I1@"})).unwrap();
    let (doc, id) = domain::edit(
        &doc,
        &json!({"type":"person","values":{"given":"Другой человек"}}),
    )
    .unwrap();
    assert_ne!(id, "@I1@");
    assert!(!gedcom::dump(&doc).unwrap().contains("1 _CLAIM original"));
}

fn apply(store: &Store, kind: &str, id: Option<&str>, values: Value) -> Value {
    store.apply(&json!({"type":kind,"id":id,"values":values,"revision":store.snapshot().unwrap()["revision"]})).unwrap()
}
#[test]
fn relative_family_and_delete_reciprocal() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    let p = apply(&s, "person", None, json!({"given":"Отец","sex":"M"}));
    let id = p["editedId"].as_str().unwrap();
    apply(
        &s,
        "addRelative",
        Some(id),
        json!({"relationship":"wife","person":{"given":"Мать","sex":"F"}}),
    );
    let fid = s.snapshot().unwrap()["families"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    let tree = apply(
        &s,
        "addRelative",
        Some(id),
        json!({"relationship":"child","familyId":fid,"person":{"given":"Дочь","sex":"F"}}),
    );
    let child = tree["families"][&fid]["children"][0].as_str().unwrap();
    let export = s.export_gedcom().unwrap();
    assert!(export.contains(&format!("1 FAMS {fid}")));
    assert!(export.contains(&format!("1 FAMC {fid}")));
    apply(&s, "deletePerson", Some(child), json!({}));
    assert_eq!(
        s.snapshot().unwrap()["families"][&fid]["children"],
        json!([])
    );
    apply(&s, "deleteFamily", Some(&fid), json!({}));
    assert!(s.snapshot().unwrap()["families"]
        .as_object()
        .unwrap()
        .is_empty());
    assert!(!s.export_gedcom().unwrap().contains("1 FAMS"));
}
#[test]
fn sqlite_instances_serialize_revision_checks() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    let revision = s.snapshot().unwrap()["revision"].clone();
    let barrier = Arc::new(Barrier::new(2));
    let threads = (0..2)
        .map(|_| {
            let path = dir.path().to_path_buf();
            let revision = revision.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                let s = Store::new(path).unwrap();
                barrier.wait();
                s.apply(&json!({"type":"person","revision":revision,"values":{"given":"Тест"}}))
                    .is_ok()
            })
        })
        .collect::<Vec<_>>();
    assert_eq!(
        threads
            .into_iter()
            .map(|t| t.join().unwrap() as usize)
            .sum::<usize>(),
        1
    );
    assert_eq!(
        s.snapshot().unwrap()["people"].as_object().unwrap().len(),
        1
    );
}
#[test]
fn malformed_history_rolls_back_written_entities() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    let before = s.document().unwrap();
    let mut bad = before.clone();
    bad["assertions"] = json!([{"value":"not saved"}]);
    bad["changeHistory"] = json!([{"action":7}]);
    assert!(s
        .import_text(
            &bad.to_string(),
            s.snapshot().unwrap()["revision"].as_str().unwrap()
        )
        .is_err());
    assert_eq!(s.document().unwrap(), before);
}
#[test]
fn backup_is_consistent_and_project_copy_is_portable() {
    let dir = tempfile::tempdir().unwrap();
    let output = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    let p = apply(&s, "person", None, json!({"given":"Иван"}));
    let id = p["editedId"].as_str().unwrap();
    apply(
        &s,
        "uploadPhoto",
        Some(id),
        json!({"data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII="}),
    );
    let project = s.export_project(output.path()).unwrap();
    let copy = Store::new(project.clone()).unwrap();
    assert_eq!(copy.document().unwrap(), s.document().unwrap());
    assert_eq!(copy.media().unwrap(), s.media().unwrap());
    let restore = tempfile::tempdir().unwrap();
    let target = Store::new(restore.path().into()).unwrap();
    target
        .import_project(
            &project,
            target.snapshot().unwrap()["revision"].as_str().unwrap(),
        )
        .unwrap();
    assert_eq!(target.document().unwrap(), s.document().unwrap());
    let backup = fs::read_dir(dir.path().join("backups"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let db = rusqlite::Connection::open(backup).unwrap();
    store::read(&db).unwrap();
}
#[test]
fn unchanged_citations_and_link_metadata_survive() {
    let input="0 HEAD\n0 @S1@ SOUR\n1 TITL Источник\n0 @F1@ FAM\n1 HUSB @I1@\n1 CHIL @I2@\n2 _META child\n0 @I1@ INDI\n1 NAME Имя /Фамилия/\n1 FAMS @F1@\n2 _META spouse\n1 EVEN Медаль\n2 TYPE Награда\n2 SOUR @S1@\n3 PAGE 42\n2 NOTE Спорная атрибуция\n1 _EXT keep\n0 @I2@ INDI\n1 FAMC @F1@\n2 PEDI adopted\n0 TRLR\n";
    let doc = gedcom::load(input).unwrap();
    assert_eq!(
        gedcom::parse(input).unwrap(),
        gedcom::parse(&gedcom::dump(&doc).unwrap()).unwrap()
    );
    let mut values = doc["people"]["@I1@"].clone();
    values["given"] = json!("Другое имя");
    let (next, _) =
        domain::edit(&doc, &json!({"type":"person","id":"@I1@","values":values})).unwrap();
    let out = gedcom::dump(&next).unwrap();
    for snippet in [
        "2 _META spouse",
        "2 _META child",
        "2 PEDI adopted",
        "3 PAGE 42",
        "2 NOTE Спорная атрибуция",
        "1 _EXT keep",
    ] {
        assert!(out.contains(snippet));
    }
}
#[test]
fn malformed_schema_and_checksum_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    let db = rusqlite::Connection::open(s.path()).unwrap();
    db.execute("UPDATE metadata SET value='wrong' WHERE key='revision'", [])
        .unwrap();
    assert!(s.snapshot().is_err());
    db.execute_batch("PRAGMA user_version=999").unwrap();
    assert!(Store::new(dir.path().into()).is_err());
}
#[test]
fn awards_keep_original_evidence_not_new_claims() {
    let text="0 HEAD\n0 @S1@ SOUR\n1 TITL Источник\n0 @I1@ INDI\n1 NAME Имя\n1 EVEN Медаль\n2 TYPE Награда\n2 SOUR @S1@\n1 EVEN Поступление на военную службу\n2 TYPE Военная служба\n2 DATE 1941\n2 SOUR @S1@\n0 TRLR\n";
    let doc = gedcom::load(text).unwrap();
    let mut values = doc["people"]["@I1@"].clone();
    values["awards"] = json!("Медаль\nНовая награда");
    values["serviceStart"] = json!("1942");
    let (next, _) =
        domain::edit(&doc, &json!({"type":"person","id":"@I1@","values":values})).unwrap();
    let evidence = next["people"]["@I1@"]["militaryEvidence"]
        .as_array()
        .unwrap();
    assert!(evidence
        .iter()
        .find(|e| e["title"] == "Новая награда")
        .unwrap()["sources"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(evidence
        .iter()
        .find(|e| e["kind"] == "serviceStart")
        .unwrap()["note"]
        .as_str()
        .unwrap()
        .contains("1941 → 1942"));
    assert!(gedcom::dump(&next)
        .unwrap()
        .contains("1 EVEN Новая награда"));
}
#[test]
fn original_date_and_arbitrary_fields_keep_precision() {
    let mut doc = domain::empty();
    let (next, id) = domain::edit(
        &doc,
        &json!({"type":"person","values":{"given":"Тест","birth":"21 MAR 19","era":"imperial"}}),
    )
    .unwrap();
    doc = next;
    doc["people"][&id]["extra"] = json!({"contradiction":"do not resolve"});
    let mut values = doc["people"][&id].clone();
    values.as_object_mut().unwrap().remove("era");
    let (next, _) = domain::edit(&doc, &json!({"type":"person","id":id,"values":values})).unwrap();
    assert_eq!(next["people"][&id]["era"], "imperial");
    assert_eq!(next["people"][&id]["birth"], "21 MAR 19");
    assert_eq!(next["people"][&id]["extra"], doc["people"][&id]["extra"]);
}

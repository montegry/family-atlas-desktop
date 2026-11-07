//! Crop settings are metadata: only temporary stores are used here.
use crate::{domain, store::Store};
use serde_json::{json, Value};
use std::fs;

fn apply(s: &Store, kind: &str, id: Option<&str>, values: Value) -> Value {
    s.apply(
        &json!({"type":kind,"id":id,"values":values,"revision":s.snapshot().unwrap()["revision"]}),
    )
    .unwrap()
}
fn fixture() -> (tempfile::TempDir, Store, String, String) {
    let dir = tempfile::tempdir().unwrap();
    let s = Store::new(dir.path().into()).unwrap();
    let p = apply(
        &s,
        "person",
        None,
        json!({"given":"Тест","birth":"21 MAR 19","note":"Сохранить"}),
    );
    let id = p["editedId"].as_str().unwrap().to_string();
    let p = apply(
        &s,
        "uploadPhoto",
        Some(&id),
        json!({"data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII="}),
    );
    let photo = p["people"][&id]["photos"][0].as_str().unwrap().to_string();
    (dir, s, id, photo)
}
fn crops() -> Value {
    json!({"tree":{"x":0.12345678,"y":0.23456789,"width":0.34567891,"height":0.45678912},"poster":{"x":0.1,"y":0.2,"width":0.7,"height":0.8},"posterPair":{"x":0.4,"y":0.1,"width":0.3,"height":0.9}})
}
#[test]
fn crop_roundtrips_and_never_rewrites_the_original() {
    let (_dir, s, id, photo) = fixture();
    let file = s.directory.join(&photo);
    let original = fs::read(&file).unwrap();
    let before = s.document().unwrap();
    apply(
        &s,
        "cropPhoto",
        Some(&id),
        json!({"photo":photo,"crops":crops(),"primary":true}),
    );
    let after = Store::new(s.directory.clone()).unwrap().document().unwrap();
    assert_eq!(after["people"][&id]["photoCrops"][&photo], crops());
    assert_eq!(after["people"][&id]["portraitPhoto"], photo);
    for key in [
        "birth",
        "note",
        "photos",
        "names",
        "events",
        "militaryEvidence",
    ] {
        assert_eq!(before["people"][&id][key], after["people"][&id][key]);
    }
    assert_eq!(fs::read(file).unwrap(), original);
    let copy_dir = tempfile::tempdir().unwrap();
    let copy = Store::new(copy_dir.path().into()).unwrap();
    copy.import_text(
        &s.export_json().unwrap(),
        copy.snapshot().unwrap()["revision"].as_str().unwrap(),
    )
    .unwrap();
    assert_eq!(after, copy.document().unwrap());
}
#[test]
fn invalid_crop_and_stale_revision_are_atomic() {
    let (_dir, s, id, photo) = fixture();
    let before = s.document().unwrap();
    let revision = domain::revision(&before).unwrap();
    let invalid = vec![
        json!({"tree":{"x":-0.1,"y":0,"width":1,"height":1}}),
        json!({"tree":{"x":0.9,"y":0,"width":0.2,"height":1}}),
        json!({"tree":{"x":0,"y":0,"width":0,"height":1}}),
        json!({"tree":{"x":false,"y":0,"width":1,"height":1}}),
        json!({"other":{"x":0,"y":0,"width":1,"height":1}}),
        json!(null),
    ];
    for settings in invalid {
        assert!(s.apply(&json!({"type":"cropPhoto","id":id,"revision":revision,"values":{"photo":photo,"crops":settings}})).is_err());
        assert_eq!(before, s.document().unwrap());
    }
    assert!(s.apply(&json!({"type":"cropPhoto","id":id,"revision":revision,"values":{"photo":"missing","crops":crops()}})).is_err());
    apply(
        &s,
        "cropPhoto",
        Some(&id),
        json!({"photo":photo,"crops":crops()}),
    );
    assert!(s.apply(&json!({"type":"cropPhoto","id":id,"revision":revision,"values":{"photo":photo,"crops":{}}})).is_err());
}
#[test]
fn unrelated_person_edit_preserves_crops_and_shared_photo_has_independent_settings() {
    let (_dir, s, id, photo) = fixture();
    apply(
        &s,
        "cropPhoto",
        Some(&id),
        json!({"photo":photo,"crops":crops(),"primary":true}),
    );
    let p = s.snapshot().unwrap()["people"][&id].clone();
    apply(&s, "person", Some(&id), p);
    assert_eq!(
        s.document().unwrap()["people"][&id]["photoCrops"][&photo],
        crops()
    );
    let new = apply(&s, "person", None, json!({"given":"Другой"}));
    let other = new["editedId"].as_str().unwrap();
    apply(
        &s,
        "uploadPhoto",
        Some(other),
        json!({"data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII="}),
    );
    let doc = s.document().unwrap();
    assert_eq!(doc["people"][other]["photos"][0], photo);
    assert!(doc["people"][other].get("photoCrops").is_none());
    apply(
        &s,
        "cropPhoto",
        Some(&id),
        json!({"photo":photo,"crops":{}}),
    );
    assert!(s.document().unwrap()["people"][&id]["photoCrops"]
        .as_object()
        .unwrap()
        .is_empty());
}

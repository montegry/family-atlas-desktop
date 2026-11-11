//! Local UI preferences, separate from family data and exports.
use anyhow::{ensure, Result};
use serde_json::{json, Value};
use std::{fs, io::Write, path::Path};

const VERSION: u64 = 1;
const FILENAME: &str = "ui-preferences.json";
fn read(directory: &Path) -> Result<Value> {
    let path = directory.join(FILENAME);
    if !path.exists() {
        return Ok(json!({}));
    }
    ensure!(
        fs::metadata(&path)?.len() <= 64_000,
        "Файл настроек интерфейса слишком велик"
    );
    let value: Value = serde_json::from_slice(&fs::read(path)?)?;
    ensure!(value.is_object(), "Некорректный файл настроек интерфейса");
    Ok(value)
}
pub fn status(directory: &Path) -> Result<Value> {
    let preferences = read(directory)?;
    Ok(
        json!({"version": VERSION, "completed": preferences["onboardingVersion"].as_u64().unwrap_or(0) >= VERSION}),
    )
}
pub fn complete(directory: &Path) -> Result<Value> {
    let mut preferences = read(directory)?;
    if preferences["onboardingVersion"].as_u64().unwrap_or(0) >= VERSION {
        return status(directory);
    }
    preferences["onboardingVersion"] = json!(VERSION);
    fs::create_dir_all(directory)?;
    let temporary = directory.join(format!(
        "ui-preferences-{}.tmp",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let result = (|| -> Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&serde_json::to_vec_pretty(&preferences)?)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, directory.join(FILENAME))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;
    status(directory)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completion_survives_restart_without_touching_family_data() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::store::Store::new(dir.path().into()).unwrap();
        let before = store.snapshot().unwrap();
        assert_eq!(status(dir.path()).unwrap()["completed"], false);
        assert!(!dir.path().join(FILENAME).exists());
        assert_eq!(complete(dir.path()).unwrap()["completed"], true);
        assert_eq!(status(dir.path()).unwrap()["completed"], true);
        assert_eq!(store.snapshot().unwrap(), before);
        assert!(!store.export_json().unwrap().contains("onboardingVersion"));
    }
    #[test]
    fn preserves_other_preferences_and_future_versions() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(FILENAME);
        fs::write(&file, br#"{"theme":"neutral","onboardingVersion":0}"#).unwrap();
        complete(dir.path()).unwrap();
        assert_eq!(read(dir.path()).unwrap()["theme"], "neutral");
        let future = br#"{"theme":"neutral","onboardingVersion":999}"#;
        fs::write(&file, future).unwrap();
        complete(dir.path()).unwrap();
        assert_eq!(fs::read(&file).unwrap(), future);
    }
    #[test]
    fn invalid_preferences_are_not_silently_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(FILENAME);
        fs::write(&file, b"not json").unwrap();
        assert!(status(dir.path()).is_err());
        assert!(complete(dir.path()).is_err());
        assert_eq!(fs::read(file).unwrap(), b"not json");
    }
}

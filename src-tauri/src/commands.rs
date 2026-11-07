use crate::{domain, store::Store};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Manager, State};

type NativeResult<T> = Result<T, String>;
struct AppState(Mutex<Store>, AtomicBool);
fn failure(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[tauri::command(async)]
fn get_tree(state: State<AppState>) -> NativeResult<Value> {
    state.0.lock().map_err(failure)?.snapshot().map_err(failure)
}
#[tauri::command(async)]
fn get_media(state: State<AppState>) -> NativeResult<Value> {
    state.0.lock().map_err(failure)?.media().map_err(failure)
}
#[tauri::command(async)]
fn get_poster_background(app: tauri::AppHandle) -> NativeResult<String> {
    // Resolve this one public packaged asset; no renderer-supplied filesystem path.
    let asset = app
        .asset_resolver()
        .get("images/nano-banana-4k-6aee231e41f09db7edd3a148.png".into())
        .ok_or("Фон плаката отсутствует в сборке")?;
    if domain::image_type(&asset.bytes).map_err(failure)? != "png" {
        return Err("Ожидается PNG-фон".into());
    }
    Ok(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(asset.bytes)
    ))
}
#[tauri::command(async)]
fn apply_action(state: State<AppState>, action: Value) -> NativeResult<Value> {
    state
        .0
        .lock()
        .map_err(failure)?
        .apply(&action)
        .map_err(failure)
}
#[tauri::command(async)]
fn import_tree(state: State<AppState>, revision: String) -> NativeResult<Option<Value>> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("Семейное дерево", &["json", "ged", "gedcom"])
        .pick_file()
    else {
        return Ok(None);
    };
    if !confirmed("Заменить рабочее дерево? Предыдущая версия будет сохранена в резервной копии.")
    {
        return Ok(None);
    }
    if fs::metadata(&path).map_err(failure)?.len() > 10_000_000 {
        return Err("Максимальный размер: 10 МБ".into());
    }
    let text = fs::read_to_string(path).map_err(failure)?;
    Ok(Some(
        state
            .0
            .lock()
            .map_err(failure)?
            .import_text(&text, &revision)
            .map_err(failure)?,
    ))
}
fn confirmed(message: &str) -> bool {
    rfd::MessageDialog::new()
        .set_title("Семейный атлас")
        .set_description(message)
        .set_buttons(rfd::MessageButtons::YesNo)
        .set_level(rfd::MessageLevel::Warning)
        .show()
        == rfd::MessageDialogResult::Yes
}
#[tauri::command(async)]
fn confirm_action(message: String) -> bool {
    confirmed(&message)
}
#[tauri::command]
fn set_dirty(state: State<AppState>, dirty: bool) {
    state.1.store(dirty, Ordering::Relaxed);
}
#[tauri::command(async)]
fn import_project(state: State<AppState>, revision: String) -> NativeResult<Option<Value>> {
    let Some(folder) = rfd::FileDialog::new()
        .set_title("Папка старого проекта или переносимой копии")
        .pick_folder()
    else {
        return Ok(None);
    };
    if !confirmed("Перенести дерево и фотографии из выбранной папки? Исходные файлы не изменятся.")
    {
        return Ok(None);
    }
    Ok(Some(
        state
            .0
            .lock()
            .map_err(failure)?
            .import_project(&folder, &revision)
            .map_err(failure)?,
    ))
}
#[tauri::command(async)]
fn export_project(state: State<AppState>) -> NativeResult<Option<String>> {
    let Some(folder) = rfd::FileDialog::new()
        .set_title("Куда сохранить дерево вместе с фотографиями")
        .pick_folder()
    else {
        return Ok(None);
    };
    Ok(Some(
        state
            .0
            .lock()
            .map_err(failure)?
            .export_project(&folder)
            .map_err(failure)?
            .to_string_lossy()
            .into(),
    ))
}
#[tauri::command(async)]
fn export_data(state: State<AppState>, kind: String, data: Option<String>) -> NativeResult<bool> {
    let bytes = match kind.as_str() {
        "json" => state
            .0
            .lock()
            .map_err(failure)?
            .export_json()
            .map_err(failure)?
            .into_bytes(),
        "ged" => state
            .0
            .lock()
            .map_err(failure)?
            .export_gedcom()
            .map_err(failure)?
            .into_bytes(),
        "svg" => {
            let data = data.ok_or("Нет данных плаката")?;
            if data.len() > 100_000_000
                || !data.trim_start().starts_with("<svg")
                || data.contains("<script")
                || data.contains("foreignObject")
            {
                return Err("Некорректный SVG".into());
            }
            data.into_bytes()
        }
        "png" => {
            let bytes = STANDARD
                .decode(data.ok_or("Нет данных PNG")?)
                .map_err(failure)?;
            if bytes.len() > 100_000_000 || domain::image_type(&bytes).map_err(failure)? != "png" {
                return Err("Некорректный PNG".into());
            }
            bytes
        }
        _ => return Err("Неизвестный формат экспорта".into()),
    };
    let default = if matches!(kind.as_str(), "svg" | "png") {
        format!("family-poster.{kind}")
    } else {
        format!("family-tree.{kind}")
    };
    let Some(path) = rfd::FileDialog::new()
        .set_file_name(&default)
        .add_filter(&kind, &[&kind])
        .save_file()
    else {
        return Ok(false);
    };
    let temporary = path.with_extension(format!(
        "{}.atlas-tmp",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    {
        use std::io::Write;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(failure)?;
        f.write_all(&bytes).map_err(failure)?;
        f.sync_all().map_err(failure)?;
    }
    fs::rename(&temporary, path).map_err(failure)?;
    Ok(true)
}
#[tauri::command(async)]
fn open_source(url: String) -> NativeResult<()> {
    let parsed = tauri::Url::parse(&url).map_err(failure)?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Разрешены только HTTP/HTTPS-ссылки источников".into());
    }
    open::that(url).map_err(failure)
}
#[tauri::command]
fn open_gallery(app: tauri::AppHandle) -> NativeResult<()> {
    if let Some(window) = app.get_webview_window("gallery") {
        return window.set_focus().map_err(failure);
    }
    tauri::WebviewWindowBuilder::new(
        &app,
        "gallery",
        tauri::WebviewUrl::App("eras/index.html".into()),
    )
    .title("Фоны эпох")
    .inner_size(1000., 800.)
    .build()
    .map_err(failure)?;
    Ok(())
}
#[tauri::command]
fn storage_info(state: State<AppState>) -> NativeResult<Value> {
    Ok(
        json!({"directory":state.0.lock().map_err(failure)?.directory,"storage":"sqlite","schemaVersion":1,"transport":"tauri-ipc"}),
    )
}

#[cfg(debug_assertions)]
#[tauri::command]
fn smoke_complete(app: tauri::AppHandle, result: Value) {
    if let Some(path) = std::env::var_os("ATLAS_SMOKE_RESULT") {
        let _ = fs::write(path, serde_json::to_vec_pretty(&result).unwrap());
        app.exit(if result["ok"] == true { 0 } else { 1 });
    }
}

pub fn run() {
    let builder=tauri::Builder::default()
        .setup(|app|{
            let directory=app.path().app_data_dir()?;
            #[cfg(debug_assertions)]
            let directory=std::env::var_os("ATLAS_DATA_DIR").map(PathBuf::from).unwrap_or(directory);
            let store=Store::new(directory)?;
            let args=std::env::args().collect::<Vec<_>>();
            if let Some(i)=args.iter().position(|a|a=="--import-project"){
                let path=PathBuf::from(args.get(i+1).ok_or("Укажите папку переноса")?);
                let rev=store.snapshot()?["revision"].as_str().unwrap().to_string();
                if !store.document()?["people"].as_object().unwrap().is_empty(){return Err("Начальный перенос разрешён только в пустую базу; используйте меню импорта".into());}
                store.import_project(&path,&rev)?;
            }
            app.manage(AppState(Mutex::new(store),AtomicBool::new(false)));Ok(())
        })
        .on_window_event(|window,event|{if let tauri::WindowEvent::CloseRequested{api,..}=event{let state=window.app_handle().state::<AppState>();if window.label()=="main"&&state.1.load(Ordering::Relaxed)&&!confirmed("В карточке есть несохранённые изменения. Закрыть приложение без сохранения?"){api.prevent_close();}}})
        .on_page_load(|webview,payload|{
            #[cfg(debug_assertions)]
            if payload.event()==tauri::webview::PageLoadEvent::Finished&&std::env::var_os("ATLAS_SMOKE_RESULT").is_some(){let _=webview.eval(include_str!("../../tests/native-smoke.js"));}
            #[cfg(not(debug_assertions))]
            let _=(webview,payload);
        });
    #[cfg(debug_assertions)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_tree,
        get_media,
        get_poster_background,
        apply_action,
        import_tree,
        import_project,
        export_project,
        export_data,
        confirm_action,
        set_dirty,
        open_source,
        open_gallery,
        storage_info,
        smoke_complete
    ]);
    #[cfg(not(debug_assertions))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        get_tree,
        get_media,
        get_poster_background,
        apply_action,
        import_tree,
        import_project,
        export_project,
        export_data,
        confirm_action,
        set_dirty,
        open_source,
        open_gallery,
        storage_info
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("Не удалось запустить Семейный атлас");
}

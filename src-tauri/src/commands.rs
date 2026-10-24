//! Commands the frontend invokes: thin wrappers over `library`. The app never runs models: it imports bundles,
//! finds their videos, and serves layer files to the viewer.

use crate::error::{Error, Result};
use crate::library::{self, BundleSummary, Carryover};
use crate::bundle;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub data_dir: PathBuf,
}

#[derive(Serialize)]
pub struct OpenedBundle {
    summary: BundleSummary,
    manifest: Value,
    /// the imported copy's folder: the viewer loads the bundle's assets (crops) from it through the asset protocol
    bundle_dir: String,
}

/// Let the webview load this one file through the asset protocol (the scope starts empty on every launch).
fn allow_video(app: &AppHandle, path: &str) -> Result<()> {
    app.asset_protocol_scope().allow_file(path)?;
    Ok(())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| Error::Bundle(e.to_string()))?
}

#[tauri::command]
pub async fn import_bundle(state: State<'_, AppState>, path: String) -> Result<BundleSummary> {
    let src = PathBuf::from(&path);
    {
        let conn = state.db.lock().unwrap();
        if let Some(id) = library::find_imported(&conn, &src)? {
            return library::get(&conn, &id); // already imported: importing again is a no-op
        }
    }
    let (data_dir, src2) = (state.data_dir.clone(), src.clone());
    let (id, manifest, dst) = blocking(move || library::prepare_import(&src2, &data_dir)).await?;
    let conn = state.db.lock().unwrap();
    library::record_import(&conn, &src, &id, &manifest, &dst)
}

#[tauri::command]
pub fn list_bundles(state: State<'_, AppState>) -> Result<Vec<BundleSummary>> {
    library::list(&state.db.lock().unwrap())
}

#[tauri::command]
pub fn open_bundle(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<OpenedBundle> {
    let conn = state.db.lock().unwrap();
    let dir = library::bundle_dir(&conn, &id)?;
    let manifest = bundle::read_manifest(&dir)?;
    let summary = library::get(&conn, &id)?;
    if let Some(path) = &summary.video_path {
        allow_video(&app, path)?;
    }
    app.asset_protocol_scope().allow_directory(dir.join("assets"), true)?;
    Ok(OpenedBundle { summary, manifest, bundle_dir: dir.to_string_lossy().into_owned() })
}

/// Check that `path` is this bundle's video (by sha256), remember where it is, and allow the viewer to play it.
#[tauri::command]
pub async fn locate_video(app: AppHandle, state: State<'_, AppState>, id: String, path: String) -> Result<BundleSummary> {
    let expected = library::expected_video(&state.db.lock().unwrap(), &id)?;
    let (e2, p2) = (expected.clone(), PathBuf::from(&path));
    blocking(move || library::check_video(&e2, &p2)).await?;
    let conn = state.db.lock().unwrap();
    library::record_video(&conn, &expected, &path)?;
    allow_video(&app, &path)?;
    library::get(&conn, &id)
}

#[tauri::command]
pub fn read_layer(state: State<'_, AppState>, id: String, name: String) -> Result<String> {
    let dir = library::bundle_dir(&state.db.lock().unwrap(), &id)?;
    library::read_layer(&dir, &name)
}

#[tauri::command]
pub fn load_corrections(state: State<'_, AppState>, id: String) -> Result<Vec<Value>> {
    library::load_corrections(&state.db.lock().unwrap(), &id)
}

#[tauri::command]
pub fn append_corrections(state: State<'_, AppState>, id: String, ops: Vec<Value>) -> Result<usize> {
    library::append_corrections(&state.db.lock().unwrap(), &id, &ops)
}

#[tauri::command]
pub fn truncate_corrections(state: State<'_, AppState>, id: String, keep: usize) -> Result<usize> {
    library::truncate_corrections(&state.db.lock().unwrap(), &id, keep)
}

#[tauri::command]
pub fn replace_corrections(state: State<'_, AppState>, id: String, ops: Vec<Value>) -> Result<usize> {
    library::replace_corrections(&state.db.lock().unwrap(), &id, &ops)
}

#[tauri::command]
pub fn read_bundle_file(state: State<'_, AppState>, id: String, path: String) -> Result<String> {
    let dir = library::bundle_dir(&state.db.lock().unwrap(), &id)?;
    library::read_bundle_file(&dir, &path)
}

#[derive(Serialize)]
pub struct FoundFile {
    path: String,
    text: String,
}

/// The prototype's corrections file next to the folder this bundle was imported from, if there is one.
#[tauri::command]
pub fn find_prototype_corrections(state: State<'_, AppState>, id: String) -> Result<Option<FoundFile>> {
    let source = library::source_dir(&state.db.lock().unwrap(), &id)?;
    Ok(library::prototype_corrections(&source)?.map(|(path, text)| FoundFile { path, text }))
}

#[tauri::command]
pub fn read_corrections_file(path: String) -> Result<String> {
    library::read_corrections_file(&PathBuf::from(path))
}

#[tauri::command]
pub fn write_corrections_file(path: String, text: String) -> Result<()> {
    library::write_corrections_file(&PathBuf::from(path), &text)
}

#[tauri::command]
pub fn count_versions(state: State<'_, AppState>, id: String) -> Result<usize> {
    library::count_versions(&state.db.lock().unwrap(), &id)
}

#[tauri::command]
pub fn find_version(state: State<'_, AppState>, id: String, manifest_sha256: String) -> Result<Option<BundleSummary>> {
    library::find_version(&state.db.lock().unwrap(), &id, &manifest_sha256)
}

#[tauri::command]
pub fn previous_version(state: State<'_, AppState>, id: String) -> Result<Option<BundleSummary>> {
    library::previous_version(&state.db.lock().unwrap(), &id)
}

#[tauri::command]
pub fn get_carryover(state: State<'_, AppState>, id: String) -> Result<Option<Carryover>> {
    library::get_carryover(&state.db.lock().unwrap(), &id)
}

#[tauri::command]
pub fn carry_over(state: State<'_, AppState>, id: String, from: String, ops: Vec<Value>, unmatched: Value) -> Result<usize> {
    library::carry_over(&state.db.lock().unwrap(), &id, &from, &ops, &unmatched)
}

#[tauri::command]
pub fn decline_carryover(state: State<'_, AppState>, id: String, from: String) -> Result<()> {
    library::decline_carryover(&state.db.lock().unwrap(), &id, &from)
}

#[tauri::command]
pub fn dismiss_unmatched(state: State<'_, AppState>, id: String, index: u64) -> Result<Carryover> {
    library::dismiss_unmatched(&state.db.lock().unwrap(), &id, index)
}

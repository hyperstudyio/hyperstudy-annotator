//! Commands the frontend invokes: thin wrappers over `library` (import bundles, find their videos, serve layer files to
//! the viewer) and `pipeline` (run the perception CLI, whose processes run the models, and import what it makes).

use crate::error::{Error, Result};
use crate::library::{self, BundleSummary, Carryover};
use crate::pipeline::{self, GraphPreset, Pipeline};
use crate::bundle;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub db: Mutex<Connection>,
    pub data_dir: PathBuf,
    /// a pipeline run in progress (one at a time: GPU nodes are exclusive); its run id once the CLI has said it
    pub running: Mutex<Option<String>>,
    /// the CLI process of that run, to stop it before it has named the run (a slow first environment sync)
    pub child: Mutex<Option<u32>>,
}

const PIPELINE_FOLDER: &str = "pipeline_folder";

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

// --- running the perception pipeline (pipeline.rs) ---

fn pipeline_at(folder: &str, data_dir: &std::path::Path) -> Result<Pipeline> {
    pipeline::check_folder(std::path::Path::new(folder), data_dir)?;
    Pipeline::new(std::path::Path::new(folder), pipeline::bundled_uv(&std::env::current_exe()?)?)
}

fn pipeline(state: &AppState) -> Result<Pipeline> {
    let folder = library::get_setting(&state.db.lock().unwrap(), PIPELINE_FOLDER)?
        .ok_or_else(|| Error::NotFound("choose the hyperstudy-perception folder first".into()))?;
    pipeline_at(&folder, &state.data_dir)
}

#[tauri::command]
pub fn get_pipeline_folder(state: State<'_, AppState>) -> Result<Option<String>> {
    library::get_setting(&state.db.lock().unwrap(), PIPELINE_FOLDER)
}

/// Check a folder with `perception doctor` and remember it; returns what the doctor found.
#[tauri::command]
pub async fn set_pipeline_folder(state: State<'_, AppState>, path: String) -> Result<Value> {
    let (folder, data_dir) = (path.clone(), state.data_dir.clone());
    let doctor = blocking(move || pipeline_at(&folder, &data_dir)?.one(&["doctor"], "doctor")).await?;
    library::set_setting(&state.db.lock().unwrap(), PIPELINE_FOLDER, &path)?;
    Ok(doctor)
}

#[tauri::command]
pub async fn pipeline_doctor(state: State<'_, AppState>) -> Result<Value> {
    let p = pipeline(&state)?;
    blocking(move || p.one(&["doctor"], "doctor")).await
}

#[tauri::command]
pub fn pipeline_graphs(state: State<'_, AppState>) -> Result<Vec<GraphPreset>> {
    pipeline(&state)?.graphs()
}

/// What a run of `graph` on `video` would do: placement, cache, downloads, missing secrets and cost per node.
#[tauri::command]
pub async fn pipeline_plan(state: State<'_, AppState>, graph: String, video: String) -> Result<Value> {
    let p = pipeline(&state)?;
    let g = p.graph(&graph)?;
    blocking(move || p.one(&["plan", &g.to_string_lossy(), "--input", &format!("video={video}")], "plan")).await
}

/// Start a run. Its objects arrive as `pipeline` events; when it succeeds, the bundle is exported, imported into the
/// library and its video recorded, then an `imported` event carries the bundle's summary.
#[tauri::command]
pub fn pipeline_run(app: AppHandle, state: State<'_, AppState>, graph: String, video: String, allow_downloads: bool,
                    allow_uploads: bool) -> Result<()> {
    let p = pipeline(&state)?;
    let g = p.graph(&graph)?;
    {
        let mut running = state.running.lock().unwrap();
        if running.is_some() {
            return Err(Error::Bundle("a pipeline run is already in progress".into()));
        }
        *running = Some(String::new());
    }
    std::thread::spawn(move || {
        let _clear = ClearRun(app.clone());   // even if this thread panics, the next run is not refused forever
        let last = match run_and_import(&app, &p, &g, &video, allow_downloads, allow_uploads) {
            Ok(last) => last,
            Err(e) => Some(serde_json::json!({"v": 1, "type": "error", "problems": [e.to_string()]})),
        };
        // cleared before the last event: once the dialog hears it, a new run may start
        clear_run(&app);
        if let Some(last) = last {
            let _ = app.emit("pipeline", last);
        }
    });
    Ok(())
}

struct ClearRun(AppHandle);
impl Drop for ClearRun {
    fn drop(&mut self) { clear_run(&self.0); }
}
fn clear_run(app: &AppHandle) {
    let state = app.state::<AppState>();
    *state.running.lock().unwrap_or_else(|e| e.into_inner()) = None;
    *state.child.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// Cancel only the run in progress (a stale dialog must not cancel another).
pub fn check_cancel(running: Option<&str>, run: &str) -> Result<()> {
    if !run.is_empty() && running == Some(run) { Ok(()) } else { Err(Error::Bundle(format!("run {run:?} is not the one in progress"))) }
}

/// The run, then its import; the final `imported` event, for the caller to send once the run is no longer in progress.
fn run_and_import(app: &AppHandle, p: &Pipeline, graph: &std::path::Path, video: &str, allow_downloads: bool,
                  allow_uploads: bool) -> Result<Option<Value>> {
    let state = app.state::<AppState>();
    let input = format!("video={video}");
    let graph = graph.to_str().ok_or_else(|| Error::Bundle(format!("the graph path is not text: {}", graph.display())))?;
    // consent is checked here too, against a fresh plan of what is about to run, not only in the dialog
    pipeline::upload_gate(&p.one(&["plan", graph, "--input", &input], "plan")?, allow_uploads)?;
    let mut args = vec!["run", graph, "--input", &input];
    if allow_downloads {
        args.push("--allow-downloads");
    }
    let outcome = p.run_to_end_with(&args, |pid| *state.child.lock().unwrap() = Some(pid), |o| {
        if o["type"] == "run.created" {   // only an id in the CLI's form stands for the run in progress
            if let Some(id) = o["run"].as_str().and_then(|r| pipeline::run_id(r).ok()) {
                *state.running.lock().unwrap() = Some(id.to_string());
            }
        }
        let _ = app.emit("pipeline", o);
    })?;
    let Some((run, status)) = outcome else { return Ok(None) };   // refused: its objects said why
    let run = pipeline::run_id(&run)?.to_string();   // it names a folder this function deletes
    if status != "succeeded" {
        return Ok(None);   // its events said what failed
    }

    let out = state.data_dir.join("exports").join(&run);
    let imported = (|| {
        let exported = p.one(&["export", &run, "--output", &out.to_string_lossy()], "exported")?;
        let path = exported["path"].as_str().ok_or_else(|| Error::Bundle("the pipeline exported no path".into()))?;
        let path = pipeline::inside(std::path::Path::new(path), &out)?;   // where it was asked, so it is removed below
        library::import_dir(&state.db, &path, &state.data_dir)
    })();
    if out.exists() {
        std::fs::remove_dir_all(&out)?;   // the library holds its own copy (or the import failed): frames and crops go
    }
    let summary = imported?;
    library::check_video(&summary.video_sha256, std::path::Path::new(video))?;   // the bundle names the video it was made from
    let conn = state.db.lock().unwrap();
    library::record_video(&conn, &summary.video_sha256, video)?;
    let summary = library::get(&conn, &summary.id)?;
    Ok(Some(serde_json::json!({"v": 1, "type": "imported", "run": run, "bundle": summary})))
}

/// Cancel the run in progress: through `perception cancel` once the CLI has named it, else by stopping its process
/// (it has not started a node yet: an environment sync, or the coordinator starting).
#[tauri::command]
pub async fn pipeline_cancel(state: State<'_, AppState>, run: Option<String>) -> Result<()> {
    let Some(run) = run else {
        let named = state.running.lock().unwrap().as_deref().is_some_and(|r| !r.is_empty());
        let pid = *state.child.lock().unwrap();
        let named = if named { state.running.lock().unwrap().clone() } else { None };
        return match (named, pid) {
            (None, Some(pid)) => pipeline::stop_process(pid),
            // the CLI named the run before the window heard it: cancel that run
            (Some(run), _) => { let p = pipeline(&state)?; blocking(move || p.one(&["cancel", &run], "canceled").map(|_| ())).await }
            (None, None) => Err(Error::Bundle("no pipeline run is in progress".into())),
        };
    };
    check_cancel(state.running.lock().unwrap().as_deref(), &run)?;
    let p = pipeline(&state)?;
    blocking(move || p.one(&["cancel", &run], "canceled").map(|_| ())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_run_in_progress_can_be_canceled() {
        assert!(check_cancel(Some("20261024-095828-1ad462"), "20261024-095828-1ad462").is_ok());
        assert!(check_cancel(Some("20261024-095828-1ad462"), "20261024-090000-000000").is_err());
        assert!(check_cancel(None, "20261024-095828-1ad462").is_err());
        assert!(check_cancel(Some(""), "").is_err());   // starting: the CLI has not named the run yet
    }
}

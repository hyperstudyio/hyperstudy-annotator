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
    /// that run's CLI process, and a cancel that came before it started (stops it before it has named the run)
    pub control: pipeline::RunControl,
    /// the user's keys, in the system keychain; the CLI gets them in its environment (shared with the threads that read
    /// and write the keychain: never the main one, where an unlock prompt would freeze the window)
    pub keys: std::sync::Arc<crate::keys::Keys>,
    /// where uv keeps the Python and packages it fetches for the app
    pub uv_dirs: pipeline::UvDirs,
    /// setting the pipeline up on first launch (`start_setup`)
    pub setup: Mutex<SetupStatus>,
}

/// Installing the pipeline from PyPI, or upgrading it (each start), then setting a new version up (`perception setup`:
/// each step's packages and weights, once per version).
#[derive(Serialize, Clone, Debug, Default)]
pub struct SetupStatus {
    pub state: SetupState,
    /// the steps finished so far, as `perception setup` reported them (`setup.step`)
    pub steps: Vec<Value>,
    /// why it failed
    pub problem: Option<String>,
    /// what did not stop it: an upgrade that could not be checked (offline), with a version already installed
    pub notice: Option<String>,
    /// a version is installed (false after an install that failed with none: nothing can be asked of the pipeline yet)
    pub installed: bool,
}

impl SetupStatus {
    /// Before setup starts: not started, with a version installed when its command is on disk.
    pub fn at_start(dirs: &pipeline::UvDirs) -> SetupStatus {
        SetupStatus { installed: dirs.perception().is_file(), ..Default::default() }
    }
}

#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SetupState {
    /// not started (a checkout from PERCEPTION_REPO is set up by its developer)
    #[default]
    Idle,
    /// installing the pipeline, or checking for a newer version: nothing can run yet
    Installing,
    /// setting a version up: the dialog can plan, a run waits
    Running,
    Done,
    Failed,
}

/// the pipeline version last set up whole (`start_setup`)
const SETUP_DONE: &str = "pipeline_setup_done";

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

/// The pipeline, without the keys stored in the app (what the CLI finds on its own: `pipeline_keys`): the one the app
/// installed from PyPI, or the checkout PERCEPTION_REPO names when the app was started with it (pipeline development).
fn pipeline_alone(state: &AppState) -> Result<Pipeline> {
    let uv = pipeline::bundled_uv(&std::env::current_exe()?)?;
    let mut p = match std::env::var_os("PERCEPTION_REPO") {
        Some(repo) => Pipeline::checkout(std::path::Path::new(&repo), uv)?,
        None => Pipeline::installed(&state.uv_dirs.perception(), uv)?,
    };
    p.uv_dirs = Some(state.uv_dirs.clone());
    Ok(p)
}

/// The pipeline every command runs: with the keys stored in the app in its environment.
fn pipeline(state: &AppState) -> Result<Pipeline> {
    let mut p = pipeline_alone(state)?;
    p.secrets = state.keys.for_cli();   // none if the keychain cannot be read: the Keys row says why
    Ok(p)
}

fn set_setup(app: &AppHandle, f: impl FnOnce(&mut SetupStatus)) {
    let state = app.state::<AppState>();
    let status = {
        let mut s = state.setup.lock().unwrap_or_else(|e| e.into_inner());
        f(&mut s);
        s.clone()
    };
    let _ = app.emit("pipeline-setup", status);
}

/// In the background: install the pipeline from PyPI, or upgrade it to the newest version this app reads, then set a
/// version up that is not yet (each step's packages and weights). Run at start-up, and again when the user retries one
/// that failed; not while one is under way. A checkout (PERCEPTION_REPO) is left to its developer.
pub fn start_setup(app: AppHandle) -> Result<()> {
    if std::env::var_os("PERCEPTION_REPO").is_some() {
        return Ok(());
    }
    {
        let state = app.state::<AppState>();
        if !begin_setup(&state.setup, &state.running)? {
            return Ok(());   // one is under way
        }
        let status = state.setup.lock().unwrap_or_else(|e| e.into_inner()).clone();   // the lock released before emitting, as in set_setup
        let _ = app.emit("pipeline-setup", status);
    }
    std::thread::spawn(move || {
        let _cleared = { let app = app.clone(); pipeline::OnPanic(move || set_setup(&app, |s| if matches!(s.state, SetupState::Installing | SetupState::Running) {
            s.state = SetupState::Failed; s.problem = Some("setting the pipeline up stopped unexpectedly".into());
        })) };
        let state = app.state::<AppState>();
        let installed = (|| {
            let uv = pipeline::bundled_uv(&std::env::current_exe()?)?;
            pipeline::install_tool(&uv, &std::env::var_os("PATH").unwrap_or_default(), &state.uv_dirs, pipeline::COMPATIBLE)
        })();
        let notice = match installed {
            Ok(_) => None,
            // offline, or PyPI unreachable: the version already here still runs, and the dialog says the check failed
            Err(e) if state.uv_dirs.perception().is_file() => Some(format!("Could not check for a newer pipeline ({e}); using the one installed")),
            Err(e) => return set_setup(&app, |s| { s.state = SetupState::Failed; s.problem = Some(e.to_string()); s.installed = false; }),
        };
        set_setup(&app, |s| s.installed = true);
        let result = (|| {
            let p = pipeline_alone(&state)?;
            let version = p.one(&["doctor"], "doctor")?["pipeline"]["version"].as_str().unwrap_or_default().to_string();
            if library::get_setting(&state.db.lock().unwrap(), SETUP_DONE)?.as_deref() == Some(version.as_str()) {
                return Ok(());
            }
            set_setup(&app, |s| { s.state = SetupState::Running; s.notice = notice.clone(); });
            p.setup(|o| if o["type"] == "setup.step" { set_setup(&app, |s| s.steps.push(o.clone())) })?;
            library::set_setting(&state.db.lock().unwrap(), SETUP_DONE, &version)
        })();
        set_setup(&app, |s| match result {
            Ok(()) => { s.state = SetupState::Done; s.notice = notice; }
            Err(e) => { s.state = SetupState::Failed; s.problem = Some(e.to_string()); s.notice = notice; }
        });
    });
    Ok(())
}

#[tauri::command]
pub fn pipeline_setup_status(state: State<'_, AppState>) -> SetupStatus {
    state.setup.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Try a setup that failed again (it fetches only what is still missing): not during a run, whose environment an
/// upgrade or a setup would change under it.
#[tauri::command]
pub fn pipeline_setup(app: AppHandle) -> Result<()> {
    start_setup(app)
}

/// Start a run unless the pipeline is being set up or another run is under way: decided under the setup's lock and
/// then the run's, so a Try again clicked as Start run is clicked cannot slip between the check and the start (the
/// same order in begin_setup: no deadlock). `started` runs under both (the run's control is started with it).
pub fn begin_run(setup: &Mutex<SetupStatus>, running: &Mutex<Option<String>>, started: impl FnOnce()) -> Result<()> {
    let s = setup.lock().unwrap_or_else(|e| e.into_inner());
    if matches!(s.state, SetupState::Installing | SetupState::Running) {
        return Err(Error::Bundle("the pipeline is still being set up: the run can start when it is done".into()));
    }
    let mut r = running.lock().unwrap_or_else(|e| e.into_inner());
    if r.is_some() {
        return Err(Error::Bundle("a pipeline run is already in progress".into()));
    }
    *r = Some(String::new());
    started();
    Ok(())
}

/// Start setting the pipeline up unless a run is under way (refused) or a setup already is (false): under the same two
/// locks, in the same order, as begin_run.
pub fn begin_setup(setup: &Mutex<SetupStatus>, running: &Mutex<Option<String>>) -> Result<bool> {
    let mut s = setup.lock().unwrap_or_else(|e| e.into_inner());
    if matches!(s.state, SetupState::Installing | SetupState::Running) {
        return Ok(false);
    }
    check_no_run(running.lock().unwrap_or_else(|e| e.into_inner()).as_deref())?;
    *s = SetupStatus { state: SetupState::Installing, installed: s.installed, ..Default::default() };
    Ok(true)
}

/// Refused while a run is in progress (starting, or named).
pub fn check_no_run(running: Option<&str>) -> Result<()> {
    match running {
        Some(_) => Err(Error::Bundle("a pipeline run is in progress: set the pipeline up again when it ends".into())),
        None => Ok(()),
    }
}

#[tauri::command]
pub async fn pipeline_doctor(state: State<'_, AppState>) -> Result<Value> {
    let p = pipeline(&state)?;
    blocking(move || p.one(&["doctor"], "doctor")).await
}

/// The lab servers nodes can run on (`perception hosts list`): what each had when it was added or last checked.
#[tauri::command]
pub async fn pipeline_hosts(state: State<'_, AppState>) -> Result<Value> {
    let p = pipeline(&state)?;
    blocking(move || p.one(&["hosts", "list"], "hosts")).await
}

/// Add, check, clean or remove a lab server (`perception hosts ACTION`); the hosts after it. Adding and checking reach
/// the machine over ssh with the user's own keys (batch mode: nothing asks for a password).
#[tauri::command]
pub async fn pipeline_host(state: State<'_, AppState>, action: String, name: String, dest: Option<String>,
                           root: Option<String>) -> Result<Value> {
    let p = pipeline(&state)?;
    let args = pipeline::host_args(&action, &name, dest.as_deref(), root.as_deref())?;
    blocking(move || p.one(&args.iter().map(String::as_str).collect::<Vec<_>>(), "hosts")).await
}

/// Which cloud GPU providers are offered to nodes that can use one, and at what price (`perception cloud
/// status|on|off [aws|runpod]`). Turning one on checks it can be used first: AWS through SkyPilot with the user's
/// credentials, RunPod with its API key (from the keychain, in the CLI's environment).
#[tauri::command]
pub async fn pipeline_cloud(state: State<'_, AppState>, on: Option<bool>, provider: Option<String>) -> Result<Value> {
    let args = cloud_args(on, provider.as_deref())?;
    let p = pipeline(&state)?;
    blocking(move || p.one(&args, "cloud")).await
}

/// The CLI's arguments for `pipeline_cloud`: only the providers the pipeline knows reach its command line.
pub fn cloud_args(on: Option<bool>, provider: Option<&str>) -> Result<Vec<&'static str>> {
    let action = match on { None => "status", Some(true) => "on", Some(false) => "off" };
    let provider = match provider {
        None => None,
        Some("aws") => Some("aws"),
        Some("runpod") => Some("runpod"),
        Some(other) => return Err(Error::Bundle(format!("not a cloud provider the pipeline has: {other:?}"))),
    };
    Ok(std::iter::once("cloud").chain(std::iter::once(action)).chain(provider).collect())
}

/// The models the pipeline's steps use (`perception models list`): each one's step, licence, size and whether it is
/// gated (its page asks you to accept terms before it can be downloaded).
#[tauri::command]
pub async fn pipeline_models(state: State<'_, AppState>) -> Result<Value> {
    let p = pipeline_alone(&state)?;   // no keys: listing models needs none
    blocking(move || p.one(&["models", "list"], "models")).await
}

// --- the user's keys (keys.rs): stored in the keychain; the web view learns only whether each is ---

#[tauri::command]
pub async fn keys_status(state: State<'_, AppState>) -> Result<Vec<crate::keys::KeyStatus>> {
    let keys = state.keys.clone();
    blocking(move || keys.status()).await
}

#[tauri::command]
pub async fn key_set(state: State<'_, AppState>, name: String, value: String) -> Result<Vec<crate::keys::KeyStatus>> {
    let keys = state.keys.clone();
    blocking(move || { keys.set(&name, &value)?; keys.status() }).await
}

#[tauri::command]
pub async fn key_remove(state: State<'_, AppState>, name: String) -> Result<Vec<crate::keys::KeyStatus>> {
    let keys = state.keys.clone();
    blocking(move || { keys.remove(&name)?; keys.status() }).await
}

/// Where the CLI finds keys on its own, without the app's (`perception keys list`: names and sources, never values),
/// so the app can say a key is already set up elsewhere; and the key files it refused.
#[tauri::command]
pub async fn pipeline_keys(state: State<'_, AppState>) -> Result<Value> {
    let p = pipeline_alone(&state)?;
    blocking(move || p.one(&["keys", "list"], "keys")).await
}

#[tauri::command]
pub async fn pipeline_graphs(state: State<'_, AppState>) -> Result<Vec<GraphPreset>> {
    let p = pipeline_alone(&state)?;   // no keys: listing graphs needs none (and reads no keychain)
    blocking(move || p.graphs()).await
}

/// The settings the user chose: node -> key -> value (`--set`).
type Settings = std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>;

/// What a run of `graph` on `video` would do: placement, cache, downloads, missing secrets and cost per node.
#[tauri::command]
pub async fn pipeline_plan(state: State<'_, AppState>, graph: String, video: String,
                           places: Option<std::collections::BTreeMap<String, String>>, settings: Option<Settings>) -> Result<Value> {
    let p = pipeline(&state)?;
    let g = p.graph(&graph)?;
    let mut args = vec!["plan".to_string(), g, "--input".into(), format!("video={video}")];
    args.extend(pipeline::place_args(&places.unwrap_or_default())?);
    args.extend(pipeline::set_args(&settings.unwrap_or_default())?);
    blocking(move || p.one(&args.iter().map(String::as_str).collect::<Vec<_>>(), "plan")).await
}

/// Start a run. Its objects arrive as `pipeline` events; when it succeeds, the bundle is exported, imported into the
/// library and its video recorded, then an `imported` event carries the bundle's summary.
#[tauri::command]
pub fn pipeline_run(app: AppHandle, state: State<'_, AppState>, graph: String, video: String,
                    uploads: Option<pipeline::Uploads>, places: Option<std::collections::BTreeMap<String, String>>,
                    only: Option<Vec<String>>, settings: Option<Settings>, max_cost_usd: Option<f64>) -> Result<()> {
    let p = pipeline(&state)?;
    let g = p.graph(&graph)?;
    // where nodes run, which run and their settings: all reach the consent re-check and the run itself
    let mut places = pipeline::place_args(&places.unwrap_or_default())?;
    places.extend(pipeline::only_args(&only.unwrap_or_default())?);
    places.extend(pipeline::set_args(&settings.unwrap_or_default())?);
    let cap = pipeline::cost_args(max_cost_usd)?;
    begin_run(&state.setup, &state.running, || state.control.start())?;
    std::thread::spawn(move || {
        let _clear = { let app = app.clone(); pipeline::OnPanic(move || clear_run(&app)) };   // a panic clears it too
        let last = match run_and_import(&app, &p, &g, &video, &uploads.unwrap_or_default(), &places, &cap) {
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

fn clear_run(app: &AppHandle) {
    let state = app.state::<AppState>();
    *state.running.lock().unwrap_or_else(|e| e.into_inner()) = None;
    state.control.clear();
}

/// Cancel only the run in progress (a stale dialog must not cancel another).
pub fn check_cancel(running: Option<&str>, run: &str) -> Result<()> {
    if !run.is_empty() && running == Some(run) { Ok(()) } else { Err(Error::Bundle(format!("run {run:?} is not the one in progress"))) }
}

/// The run, then its import; the final `imported` event, for the caller to send once the run is no longer in progress.
fn run_and_import(app: &AppHandle, p: &Pipeline, graph: &str, video: &str,
                  uploads: &pipeline::Uploads, places: &[String], cap: &[String]) -> Result<Option<Value>> {
    let state = app.state::<AppState>();
    let input = format!("video={video}");
    // consent is checked here too, against a fresh plan of what is about to run, not only in the dialog
    let places: Vec<&str> = places.iter().map(String::as_str).collect();
    let plan_args = [&["plan", graph, "--input", &input][..], &places].concat();
    pipeline::upload_gate(&p.one(&plan_args, "plan")?, uploads)?;
    state.control.before_start()?;   // canceled while that plan ran: nothing starts
    // models download as part of running the features chosen (their details list them)
    let cap: Vec<&str> = cap.iter().map(String::as_str).collect();
    let mut args = [&["run", graph, "--input", &input, "--allow-downloads"][..], &places, &cap].concat();
    // anything agreed (a node on another machine may send inputs that hold none of the kinds): the upload gate above
    // held the fresh plan to exactly this
    if !uploads.is_empty() {
        args.push("--allow-uploads");
    }
    let outcome = p.run_to_end_with(&args, |pid| {
        if state.control.spawned(pid) {   // canceled between the consent check and now: stop what just started
            let _ = pipeline::stop_process(pid);
        }
    }, |o| {
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
        let named = state.running.lock().unwrap().clone().filter(|r| !r.is_empty());
        if let Some(run) = named {   // the CLI named the run before the window heard it: cancel that run
            let p = pipeline(&state)?;
            return blocking(move || p.one(&["cancel", &run], "canceled").map(|_| ())).await;
        }
        return match state.control.cancel() {
            pipeline::Cancel::Stop(pid) => pipeline::stop_process(pid),
            pipeline::Cancel::WillNotStart => Ok(()),
            pipeline::Cancel::Nothing => Err(Error::Bundle("no pipeline run is in progress".into())),
        };
    };
    check_cancel(state.running.lock().unwrap().as_deref(), &run)?;
    let p = pipeline(&state)?;
    blocking(move || p.one(&["cancel", &run], "canceled").map(|_| ())).await
}

/// The app is quitting (RunEvent::Exit): a run canceled as Cancel does, and nothing the app started left running
/// (`pipeline::stop_for_quit`). With the keys, as Cancel's: the CLI may need one to reach a cloud machine. Reading them
/// cannot prompt here: the run read them when it started (`pipeline`), and they are not read again (`Keys::loaded`).
pub fn stop_on_exit(app: &AppHandle) {
    let state = app.state::<AppState>();
    let named = state.running.lock().unwrap_or_else(|e| e.into_inner()).clone().filter(|r| !r.is_empty());
    let p = named.as_ref().and_then(|_| pipeline(&state).ok());
    pipeline::stop_for_quit(p.as_ref(), named.as_deref(), &state.control, &pipeline::PROCS, std::time::Duration::from_secs(5));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn idle() -> (Mutex<SetupStatus>, Mutex<Option<String>>) {
        (Mutex::new(SetupStatus { state: SetupState::Done, installed: true, ..Default::default() }), Mutex::new(None))
    }

    #[test]
    fn only_known_cloud_providers_reach_the_command_line() {
        assert_eq!(cloud_args(None, None).unwrap(), ["cloud", "status"]);
        assert_eq!(cloud_args(Some(true), Some("runpod")).unwrap(), ["cloud", "on", "runpod"]);
        assert_eq!(cloud_args(Some(false), Some("aws")).unwrap(), ["cloud", "off", "aws"]);
        for bad in ["gcp", "--json", "runpod; rm", ""] {
            assert!(cloud_args(Some(true), Some(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn a_version_on_disk_is_known_as_installed_from_the_start() {
        let root = tempfile::tempdir().unwrap();
        let dirs = pipeline::UvDirs { python: root.path().join("python"), cache: root.path().join("cache"),
                                      tools: root.path().join("tools"), bin: root.path().join("bin") };
        assert!(!SetupStatus::at_start(&dirs).installed);
        std::fs::create_dir_all(&dirs.bin).unwrap();
        std::fs::write(dirs.perception(), "").unwrap();
        // known before the install step returns: a setup that stops before then (OnPanic: Failed) still lets the
        // dialog ask the version that is here
        let s = SetupStatus::at_start(&dirs);
        assert!(s.installed);
        assert_eq!(s.state, SetupState::Idle);
    }

    #[test]
    fn a_run_and_a_setup_never_start_together() {
        let (setup, running) = idle();
        let mut started = 0;
        begin_run(&setup, &running, || started += 1).unwrap();
        assert!(begin_setup(&setup, &running).unwrap_err().to_string().contains("run is in progress"));
        assert!(begin_run(&setup, &running, || started += 1).unwrap_err().to_string().contains("already in progress"));
        assert_eq!(started, 1);

        let (setup, running) = idle();
        assert!(begin_setup(&setup, &running).unwrap());
        assert!(!begin_setup(&setup, &running).unwrap());   // one is under way: not started twice
        assert!(begin_run(&setup, &running, || {}).unwrap_err().to_string().contains("still being set up"));
        assert!(setup.lock().unwrap().installed);   // an installed version stays known while it is set up again
    }

    #[test]
    fn a_run_and_a_setup_clicked_at_once_never_both_start() {
        for _ in 0..2000 {
            let (setup, running) = idle();
            let (ran, set) = std::thread::scope(|s| {
                let run = s.spawn(|| begin_run(&setup, &running, || {}).is_ok());
                let up = s.spawn(|| begin_setup(&setup, &running).unwrap_or(false));
                (run.join().unwrap(), up.join().unwrap())
            });
            assert!(ran != set, "a run and a setup both started (or neither): {ran} {set}");
        }
    }

    #[test]
    fn the_pipeline_is_not_set_up_again_during_a_run() {
        assert!(check_no_run(None).is_ok());
        assert!(check_no_run(Some("")).unwrap_err().to_string().contains("run is in progress"));   // starting
        assert!(check_no_run(Some("20261024-095828-1ad462")).is_err());
    }

    #[test]
    fn only_the_run_in_progress_can_be_canceled() {
        assert!(check_cancel(Some("20261024-095828-1ad462"), "20261024-095828-1ad462").is_ok());
        assert!(check_cancel(Some("20261024-095828-1ad462"), "20261024-090000-000000").is_err());
        assert!(check_cancel(None, "20261024-095828-1ad462").is_err());
        assert!(check_cancel(Some(""), "").is_err());   // starting: the CLI has not named the run yet
    }
}

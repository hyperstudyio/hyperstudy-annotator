mod awake;
mod bundle;
mod commands;
mod db;
mod error;
mod keys;
mod library;
#[cfg(target_os = "macos")]
mod menu;
mod pipeline;

use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            menu::install(app)?;   // Check for Updates… in the app menu
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(data_dir.join("bundles"))?;
            let conn = db::open(&data_dir.join("annotator.db"))?;
            let uv_dirs = pipeline::UvDirs { python: data_dir.join("python"), cache: app.path().app_cache_dir()?.join("uv"),
                                             tools: data_dir.join("tools"), bin: data_dir.join("bin") };
            let setup = Mutex::new(commands::SetupStatus::at_start(&uv_dirs));
            app.manage(commands::AppState { db: Mutex::new(conn), data_dir, running: Mutex::new(None), control: Default::default(),
                                            keys: std::sync::Arc::new(keys::Keys::new(Box::new(keys::Keychain(keys::SERVICE)))),
                                            uv_dirs, setup });
            commands::start_setup(app.handle().clone())?;   // install or upgrade the pipeline, set a new version up: in the background
            #[cfg(unix)]
            quit_on_signals(app.handle().clone())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_bundle,
            commands::list_bundles,
            commands::open_bundle,
            commands::locate_video,
            commands::read_layer,
            commands::load_corrections,
            commands::append_corrections,
            commands::truncate_corrections,
            commands::replace_corrections,
            commands::read_bundle_file,
            commands::find_prototype_corrections,
            commands::read_corrections_file,
            commands::write_corrections_file,
            commands::previous_version,
            commands::count_versions,
            commands::find_version,
            commands::get_carryover,
            commands::carry_over,
            commands::decline_carryover,
            commands::dismiss_unmatched,
            commands::pipeline_setup_status,
            commands::pipeline_setup,
            commands::pipeline_doctor,
            commands::pipeline_graphs,
            commands::pipeline_hosts,
            commands::pipeline_host,
            commands::ssh_config_hosts,
            commands::pipeline_key_check,
            commands::pipeline_cloud_check,
            commands::pipeline_cloud,
            commands::pipeline_models,
            commands::pipeline_plan,
            commands::pipeline_run,
            commands::pipeline_cancel,
            commands::keys_status,
            commands::key_set,
            commands::key_remove,
            commands::pipeline_keys,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the annotator")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                commands::stop_on_exit(app);   // a run canceled, and nothing the app started outlives it
            }
        });
}

/// TERM, INT and HUP (`kill`, Ctrl-C in `tauri dev`, the terminal it was started from closing) quit the app as its Quit
/// does, so RunEvent::Exit stops what it started (`commands::stop_on_exit`); before, a signal ended it on the spot and
/// the pipeline lived on. A second signal ends it at once, should quitting itself hang.
#[cfg(unix)]
fn quit_on_signals(app: tauri::AppHandle) -> std::io::Result<()> {
    use signal_hook::consts::{SIGHUP, SIGINT, SIGTERM};
    let mut signals = signal_hook::iterator::Signals::new([SIGTERM, SIGINT, SIGHUP])?;
    std::thread::spawn(move || {
        let mut received = signals.forever();
        if received.next().is_some() {
            app.exit(0);
        }
        if received.next().is_some() {
            std::process::exit(1);
        }
    });
    Ok(())
}

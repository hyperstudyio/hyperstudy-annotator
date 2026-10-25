mod bundle;
mod commands;
mod db;
mod error;
mod keys;
mod library;
mod pipeline;

use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(data_dir.join("bundles"))?;
            let conn = db::open(&data_dir.join("annotator.db"))?;
            app.manage(commands::AppState { db: Mutex::new(conn), data_dir, running: Mutex::new(None), control: Default::default(),
                                            keys: std::sync::Arc::new(keys::Keys::new(Box::new(keys::Keychain(keys::SERVICE)))) });
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
            commands::get_pipeline_folder,
            commands::set_pipeline_folder,
            commands::pipeline_doctor,
            commands::pipeline_graphs,
            commands::pipeline_hosts,
            commands::pipeline_host,
            commands::pipeline_cloud,
            commands::pipeline_plan,
            commands::pipeline_run,
            commands::pipeline_cancel,
            commands::keys_status,
            commands::key_set,
            commands::key_remove,
            commands::pipeline_keys,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the annotator");
}

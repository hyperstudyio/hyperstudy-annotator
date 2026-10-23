mod bundle;
mod commands;
mod db;
mod error;
mod library;

use std::sync::Mutex;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(data_dir.join("bundles"))?;
            let conn = db::open(&data_dir.join("annotator.db"))?;
            app.manage(commands::AppState { db: Mutex::new(conn), data_dir });
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running the annotator");
}

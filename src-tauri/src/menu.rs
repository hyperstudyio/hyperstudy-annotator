//! The macOS app menu: the standard one, with Check for Updates… under About, and Import… (⌘O) and Export… (⌘E) at the
//! top of File. Choosing one tells the page (`menu://<id>`): it checks and shows the answer in Settings, imports a
//! video's annotation, or exports the open one. Other platforms keep no menu bar; their check is in Settings, and
//! Import and Export are on the Annotator page.

use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{App, Emitter, Runtime};

pub const CHECK_FOR_UPDATES: &str = "check-for-updates";
pub const IMPORT: &str = "import";
pub const EXPORT: &str = "export";

pub fn install<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let menu = Menu::default(app.handle())?;
    let items = menu.items()?;
    if let Some(MenuItemKind::Submenu(app_menu)) = items.first() {
        let check = MenuItem::with_id(app, CHECK_FOR_UPDATES, "Check for Updates…", true, None::<&str>)?;
        app_menu.insert(&check, 1)?;   // after About
    }
    for item in &items {
        if let MenuItemKind::Submenu(file) = item {
            if file.text()? == "File" {
                file.insert(&MenuItem::with_id(app, IMPORT, "Import…", true, Some("CmdOrCtrl+O"))?, 0)?;
                file.insert(&MenuItem::with_id(app, EXPORT, "Export…", true, Some("CmdOrCtrl+E"))?, 1)?;
            }
        }
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if [CHECK_FOR_UPDATES, IMPORT, EXPORT].contains(&id) {
            let _ = app.emit(&format!("menu://{id}"), ());
        }
    });
    Ok(())
}

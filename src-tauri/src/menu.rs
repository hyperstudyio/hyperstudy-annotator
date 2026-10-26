//! The macOS app menu: the standard one, with Check for Updates… under About. Choosing it tells the page
//! (`menu://check-for-updates`), which checks and shows the answer in Settings. Other platforms keep no menu bar; their
//! check is in Settings.

use tauri::menu::{Menu, MenuItem, MenuItemKind};
use tauri::{App, Emitter, Runtime};

pub const CHECK_FOR_UPDATES: &str = "check-for-updates";

pub fn install<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let menu = Menu::default(app.handle())?;
    if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.into_iter().next() {
        let check = MenuItem::with_id(app, CHECK_FOR_UPDATES, "Check for Updates…", true, None::<&str>)?;
        app_menu.insert(&check, 1)?;   // after About
    }
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        if event.id() == CHECK_FOR_UPDATES {
            let _ = app.emit("menu://check-for-updates", ());
        }
    });
    Ok(())
}

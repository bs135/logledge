// Backend modules are wired to Tauri commands at the end of Phase 2; until
// then they are only exercised by their tests.
#[allow(dead_code)]
mod config;
#[allow(dead_code)]
mod error;
#[allow(dead_code)]
mod fuzzy;
#[allow(dead_code)]
mod gitsync;
#[allow(dead_code)]
mod search;
#[allow(dead_code)]
mod vault;
#[allow(dead_code)]
mod watcher;

use tauri::Manager;

/// Label of the single application window declared in tauri.conf.json.
const MAIN_WINDOW: &str = "main";

/// Brings the existing main window to the foreground (restoring it if it was
/// minimized or hidden to the tray).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first so a second launch exits before other
        // plugins initialize; the running instance is focused instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

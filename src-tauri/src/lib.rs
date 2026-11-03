mod commands;
mod config;
mod error;
mod fuzzy;
mod gitsync;
mod search;
mod state;
mod vault;
mod watcher;

use std::sync::Arc;

use tauri::{Emitter, Manager};

use search::SearchService;
use state::AppState;

/// Event telling the frontend to refetch the Vault tree.
const VAULT_CHANGED_EVENT: &str = "vault:changed";

/// Event carrying GitHub sync status changes for the status bar.
const SYNC_STATUS_EVENT: &str = "sync:status";

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
        .setup(|app| {
            let config_path = config::default_path()?;
            let vault_handle = app.handle().clone();
            let sync_handle = app.handle().clone();
            let state = AppState::new(
                config_path,
                SearchService::new(),
                Arc::new(move || {
                    let _ = vault_handle.emit(VAULT_CHANGED_EVENT, ());
                }),
                Arc::new(move |status| {
                    let _ = sync_handle.emit(SYNC_STATUS_EVENT, status);
                }),
            );
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::init_vault,
            commands::pick_vault_folder,
            commands::select_vault_folder,
            commands::detect_vault_info,
            commands::save_vault,
            commands::get_vault_list,
            commands::switch_vault,
            commands::remove_vault,
            commands::get_app_settings,
            commands::get_language,
            commands::save_app_settings,
            commands::get_file_filter_config,
            commands::save_file_filter_config,
            commands::get_tree,
            commands::create_file,
            commands::create_folder,
            commands::rename_entry,
            commands::move_entry,
            commands::delete_entry,
            commands::duplicate_entry,
            commands::copy_entry,
            commands::get_absolute_path,
            commands::get_native_relative_path,
            commands::reveal_in_explorer,
            commands::read_file,
            commands::write_file,
            commands::write_file_if_unchanged,
            commands::save_attachment,
            commands::read_attachment_data_url,
            commands::search_notes,
            commands::quick_switch,
            commands::get_sync_settings,
            commands::configure_sync,
            commands::set_github_pat,
            commands::sync_now,
            commands::get_sync_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

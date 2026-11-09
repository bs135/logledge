mod autostart;
mod commands;
mod config;
mod error;
mod fuzzy;
mod gitsync;
mod lifecycle;
mod links;
mod search;
mod state;
mod tray;
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
/// Emitted after the search index changed, so backlinks can refresh.
const SEARCH_INDEXED_EVENT: &str = "search:indexed";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered first so a second launch exits before other
        // plugins initialize; the running instance is focused instead.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A login launch while already running changes nothing.
            if !autostart::launched_at_login(&args) {
                lifecycle::show_main_window(app);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config_path = config::default_path()?;
            let vault_handle = app.handle().clone();
            let sync_handle = app.handle().clone();
            let indexed_handle = app.handle().clone();
            let search = SearchService::new();
            search.set_on_indexed(Arc::new(move || {
                let _ = indexed_handle.emit(SEARCH_INDEXED_EVENT, ());
            }));
            let state = AppState::new(
                config_path,
                search,
                Arc::new(move || {
                    let _ = vault_handle.emit(VAULT_CHANGED_EVENT, ());
                }),
                Arc::new(move |status| {
                    let _ = sync_handle.emit(SYNC_STATUS_EVENT, status);
                }),
            );
            tray::init(app.handle(), &state.language())?;

            // The window starts hidden (tauri.conf.json); a login launch stays
            // in the tray.
            if !autostart::launched_at_login(std::env::args()) {
                lifecycle::show_main_window(app.handle());
            }
            // Keep the OS login entry in line with the saved setting (on by
            // default, so the first run registers it). Skipped in debug builds
            // so `tauri dev` doesn't register the dev binary at login.
            if !cfg!(debug_assertions) {
                let enabled = state.launch_at_startup();
                std::thread::spawn(move || {
                    if let Err(e) = autostart::apply(enabled) {
                        eprintln!("{e}");
                    }
                });
            }

            app.manage(state);
            Ok(())
        })
        .on_window_event(lifecycle::on_window_event)
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
            commands::get_launch_at_startup,
            commands::set_launch_at_startup,
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
            commands::backlinks,
            commands::mentions,
            commands::get_sync_settings,
            commands::configure_sync,
            commands::set_github_pat,
            commands::sync_now,
            commands::get_sync_status,
            commands::quit_app,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(lifecycle::on_run_event);
}

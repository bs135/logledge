//! System tray icon with Open / Sync now / Quit, labelled in the UI language.
//! Unlike the Go build (Windows only), Tauri's tray also works on macOS and
//! Linux.

use std::sync::Arc;
use std::thread;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::lifecycle::{graceful_quit, show_main_window};
use crate::state::AppState;

const MENU_SHOW: &str = "show";
const MENU_SYNC: &str = "sync";
const MENU_QUIT: &str = "quit";

/// Menu items kept so their labels can follow language changes.
struct TrayMenu {
    show: MenuItem<Wry>,
    sync: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

/// (open, sync now, quit) labels for a UI language.
fn labels(language: &str) -> [&'static str; 3] {
    if language == "en" {
        ["Open Logledge", "Sync Now", "Quit"]
    } else {
        ["Mở Logledge", "Đồng bộ ngay", "Thoát"]
    }
}

/// Creates the tray icon. Left click shows the window; the menu opens on
/// right click.
pub fn init(app: &AppHandle, language: &str) -> tauri::Result<()> {
    let [show_label, sync_label, quit_label] = labels(language);
    let show = MenuItem::with_id(app, MENU_SHOW, show_label, true, None::<&str>)?;
    let sync = MenuItem::with_id(app, MENU_SYNC, sync_label, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, quit_label, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &sync, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Logledge")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW => show_main_window(app),
            MENU_SYNC => {
                if let Some(state) = app.try_state::<Arc<AppState>>() {
                    let sync = Arc::clone(&state.sync);
                    thread::spawn(move || {
                        let _ = sync.sync();
                    });
                }
            }
            MENU_QUIT => graceful_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;

    app.manage(TrayMenu { show, sync, quit });
    Ok(())
}

/// Relabels the tray menu after the UI language changes.
pub fn set_language(app: &AppHandle, language: &str) {
    if let Some(menu) = app.try_state::<TrayMenu>() {
        let [show, sync, quit] = labels(language);
        let _ = menu.show.set_text(show);
        let _ = menu.sync.set_text(sync);
        let _ = menu.quit.set_text(quit);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_follow_language_with_vietnamese_default() {
        assert_eq!(labels("en"), ["Open Logledge", "Sync Now", "Quit"]);
        assert_eq!(labels("vi"), ["Mở Logledge", "Đồng bộ ngay", "Thoát"]);
        assert_eq!(labels(""), labels("vi"));
    }
}

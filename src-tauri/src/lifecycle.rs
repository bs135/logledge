//! Window and process lifecycle: closing the window hides it to the tray, and
//! every way of quitting (tray menu, title bar Ctrl+click, OS-initiated exit)
//! goes through one graceful path that runs a final, time-limited sync.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent, Window, WindowEvent};

use crate::state::AppState;

/// Label of the single application window declared in tauri.conf.json.
pub const MAIN_WINDOW: &str = "main";

/// Upper bound for the final sync on exit, so a slow or severed network never
/// hangs quitting.
const FINAL_SYNC_TIMEOUT: Duration = Duration::from_secs(8);

/// Set once quitting starts; the exit we trigger ourselves is then allowed.
static QUITTING: AtomicBool = AtomicBool::new(false);

/// Brings the main window to the foreground, restoring it if it was minimized
/// or hidden to the tray.
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Quits the app after a final sync (at most [`FINAL_SYNC_TIMEOUT`]). The
/// window is hidden first so quitting feels immediate. Repeated calls are
/// ignored.
pub fn graceful_quit(app: &AppHandle) {
    if QUITTING.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.hide();
    }
    let app = app.clone();
    thread::spawn(move || {
        if let Some(state) = app.try_state::<Arc<AppState>>() {
            state.final_sync(FINAL_SYNC_TIMEOUT);
        }
        app.exit(0);
    });
}

/// Closing the window (Alt+F4, taskbar "Close window") hides it to the tray
/// instead of quitting, like the Wails build's HideWindowOnClose.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == MAIN_WINDOW && !QUITTING.load(Ordering::SeqCst) {
            api.prevent_close();
            let _ = window.hide();
        }
    }
}

/// Routes exit requests not started by [`graceful_quit`] (e.g. Cmd+Q on macOS)
/// through it, so the final sync always runs.
pub fn on_run_event(app: &AppHandle, event: RunEvent) {
    if let RunEvent::ExitRequested { api, .. } = event {
        if !QUITTING.load(Ordering::SeqCst) {
            api.prevent_exit();
            graceful_quit(app);
        }
    }
}

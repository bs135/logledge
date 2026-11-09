//! Tauri commands: one per method the Go `App` struct bound to the frontend
//! (same names in snake_case and same arguments). Every command runs its work
//! on a blocking thread so file, git and SQLite work never stalls the UI
//! thread. `GetAppVersion` and `CheckForUpdate` move to the frontend.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

use crate::autostart;
use crate::config::{Config, FileFilterConfig, VaultEntry};
use crate::error::{Error, Result};
use crate::gitsync::{self, Status};
use crate::grep::GrepOptions;
use crate::lifecycle;
use crate::search::{GrepResult, LinkRef, SearchResult, TagCount};
use crate::state::{AppState, ReplaceOutcome, ReplaceTarget, SyncSettings};
use crate::tray;
use crate::vault::{clean_path, Node, WriteResult};

/// Max results for Global Search and the Quick Switcher.
const SEARCH_LIMIT: usize = 30;

type AppStateRef<'a> = State<'a, Arc<AppState>>;

async fn blocking<T, F>(state: &Arc<AppState>, f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&AppState) -> Result<T> + Send + 'static,
{
    let state = Arc::clone(state);
    tauri::async_runtime::spawn_blocking(move || f(&state))
        .await
        .map_err(|e| Error::msg(e.to_string()))?
}

/// Opens the native folder picker; `None` when cancelled.
fn pick_folder(app: &AppHandle) -> Result<Option<PathBuf>> {
    match app
        .dialog()
        .file()
        .set_title("Chọn thư mục làm Vault")
        .blocking_pick_folder()
    {
        Some(path) => Ok(Some(clean_path(
            &path.into_path().map_err(|e| Error::msg(e.to_string()))?,
        ))),
        None => Ok(None),
    }
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

// --- Vaults & settings -------------------------------------------------------

#[tauri::command]
pub async fn init_vault(state: AppStateRef<'_>) -> Result<String> {
    blocking(&state, |s| s.init_vault()).await
}

#[tauri::command]
pub async fn pick_vault_folder(app: AppHandle) -> Result<String> {
    tauri::async_runtime::spawn_blocking(move || pick_folder(&app))
        .await
        .map_err(|e| Error::msg(e.to_string()))?
        .map(|p| p.as_deref().map(path_string).unwrap_or_default())
}

#[tauri::command]
pub async fn select_vault_folder(app: AppHandle, state: AppStateRef<'_>) -> Result<String> {
    blocking(&state, move |s| {
        let Some(dir) = pick_folder(&app)? else {
            return Ok(String::new());
        };
        s.save_vault(s.detect_vault_info(&dir), true)?;
        Ok(path_string(&dir))
    })
    .await
}

#[tauri::command]
pub async fn detect_vault_info(state: AppStateRef<'_>, path: String) -> Result<VaultEntry> {
    blocking(&state, move |s| Ok(s.detect_vault_info(Path::new(&path)))).await
}

#[tauri::command]
pub async fn save_vault(
    state: AppStateRef<'_>,
    entry: VaultEntry,
    make_active: bool,
) -> Result<()> {
    blocking(&state, move |s| s.save_vault(entry, make_active)).await
}

#[tauri::command]
pub async fn get_vault_list(state: AppStateRef<'_>) -> Result<Vec<VaultEntry>> {
    blocking(&state, |s| s.get_vault_list()).await
}

#[tauri::command]
pub async fn switch_vault(state: AppStateRef<'_>, target_path: String) -> Result<()> {
    blocking(&state, move |s| s.switch_vault(Path::new(&target_path))).await
}

#[tauri::command]
pub async fn remove_vault(state: AppStateRef<'_>, target_path: String) -> Result<()> {
    blocking(&state, move |s| s.remove_vault(Path::new(&target_path))).await
}

#[tauri::command]
pub async fn get_app_settings(state: AppStateRef<'_>) -> Result<Config> {
    blocking(&state, |s| s.get_app_settings()).await
}

#[tauri::command]
pub fn get_language(state: AppStateRef<'_>) -> String {
    state.language()
}

#[tauri::command]
pub async fn save_app_settings(
    app: AppHandle,
    state: AppStateRef<'_>,
    theme: String,
    language: String,
) -> Result<()> {
    blocking(&state, move |s| {
        s.save_app_settings(&theme, &language)?;
        tray::set_language(&app, &s.language());
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_launch_at_startup(state: AppStateRef<'_>) -> Result<bool> {
    blocking(&state, |s| Ok(s.launch_at_startup())).await
}

/// Registers/unregisters the login launch, then saves the choice. Nothing is
/// saved when the OS refuses, so the toggle never shows a state that isn't
/// applied.
#[tauri::command]
pub async fn set_launch_at_startup(state: AppStateRef<'_>, enabled: bool) -> Result<()> {
    blocking(&state, move |s| {
        autostart::set(enabled)?;
        s.save_launch_at_startup(enabled)
    })
    .await
}

#[tauri::command]
pub async fn get_file_filter_config(state: AppStateRef<'_>) -> Result<FileFilterConfig> {
    blocking(&state, |s| s.get_file_filter_config()).await
}

#[tauri::command]
pub async fn save_file_filter_config(
    state: AppStateRef<'_>,
    filter: FileFilterConfig,
) -> Result<()> {
    blocking(&state, move |s| s.save_file_filter_config(filter)).await
}

// --- File tree & notes ---------------------------------------------------------

#[tauri::command]
pub async fn get_tree(state: AppStateRef<'_>) -> Result<Node> {
    blocking(&state, |s| s.vault.tree()).await
}

#[tauri::command]
pub async fn create_file(
    state: AppStateRef<'_>,
    parent_rel_path: String,
    name: String,
) -> Result<String> {
    blocking(&state, move |s| {
        let path = s.vault.create_file(&parent_rel_path, &name)?;
        let _ = s.search.reindex_file(&path);
        Ok(path)
    })
    .await
}

#[tauri::command]
pub async fn create_folder(
    state: AppStateRef<'_>,
    parent_rel_path: String,
    name: String,
) -> Result<String> {
    blocking(&state, move |s| {
        s.vault.create_folder(&parent_rel_path, &name)
    })
    .await
}

#[tauri::command]
pub async fn rename_entry(
    state: AppStateRef<'_>,
    rel_path: String,
    new_name: String,
) -> Result<String> {
    blocking(&state, move |s| {
        let path = s.vault.rename(&rel_path, &new_name)?;
        s.reindex_in_background();
        Ok(path)
    })
    .await
}

#[tauri::command]
pub async fn move_entry(
    state: AppStateRef<'_>,
    src_rel_path: String,
    dest_parent_rel_path: String,
) -> Result<String> {
    blocking(&state, move |s| {
        let path = s.vault.move_entry(&src_rel_path, &dest_parent_rel_path)?;
        s.reindex_in_background();
        Ok(path)
    })
    .await
}

#[tauri::command]
pub async fn delete_entry(state: AppStateRef<'_>, rel_path: String) -> Result<()> {
    blocking(&state, move |s| {
        s.vault.delete(&rel_path)?;
        s.reindex_in_background();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn duplicate_entry(state: AppStateRef<'_>, rel_path: String) -> Result<String> {
    blocking(&state, move |s| {
        let path = s.vault.duplicate(&rel_path)?;
        s.reindex_in_background();
        Ok(path)
    })
    .await
}

#[tauri::command]
pub async fn copy_entry(
    state: AppStateRef<'_>,
    src_rel_path: String,
    dest_parent_rel_path: String,
) -> Result<String> {
    blocking(&state, move |s| {
        let path = s.vault.copy(&src_rel_path, &dest_parent_rel_path)?;
        s.reindex_in_background();
        Ok(path)
    })
    .await
}

#[tauri::command]
pub async fn get_absolute_path(state: AppStateRef<'_>, rel_path: String) -> Result<String> {
    blocking(&state, move |s| {
        s.vault.abs_path(&rel_path).map(|p| path_string(&p))
    })
    .await
}

#[tauri::command]
pub async fn get_native_relative_path(state: AppStateRef<'_>, rel_path: String) -> Result<String> {
    blocking(&state, move |s| s.vault.native_rel_path(&rel_path)).await
}

/// Opens the system file manager with the entry selected.
#[tauri::command]
pub async fn reveal_in_explorer(state: AppStateRef<'_>, rel_path: String) -> Result<()> {
    blocking(&state, move |s| {
        let abs = s.vault.abs_path(&rel_path)?;
        if !abs.exists() {
            return Err(Error::msg(format!(
                "reveal: {} does not exist",
                abs.display()
            )));
        }
        tauri_plugin_opener::reveal_item_in_dir(&abs)
            .map_err(|e| Error::msg(format!("reveal: cannot open file manager: {e}")))
    })
    .await
}

#[tauri::command]
pub async fn read_file(state: AppStateRef<'_>, rel_path: String) -> Result<String> {
    blocking(&state, move |s| s.vault.read_file(&rel_path)).await
}

#[tauri::command]
pub async fn write_file(state: AppStateRef<'_>, rel_path: String, content: String) -> Result<()> {
    blocking(&state, move |s| {
        s.vault.write_file(&rel_path, &content)?;
        // The app's own saves are hidden from the watcher: index the note now.
        let _ = s.search.reindex_file(&rel_path);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn write_file_if_unchanged(
    state: AppStateRef<'_>,
    rel_path: String,
    content: String,
    expected: String,
) -> Result<WriteResult> {
    blocking(&state, move |s| {
        let res = s
            .vault
            .write_file_if_unchanged(&rel_path, &content, &expected)?;
        if res.saved {
            // The app's own saves are hidden from the watcher: index the note now.
            let _ = s.search.reindex_file(&rel_path);
        }
        Ok(res)
    })
    .await
}

#[tauri::command]
pub async fn save_attachment(
    state: AppStateRef<'_>,
    note_rel_path: String,
    filename: String,
    base64_data: String,
) -> Result<String> {
    blocking(&state, move |s| {
        s.vault
            .save_attachment(&note_rel_path, &filename, &base64_data)
    })
    .await
}

#[tauri::command]
pub async fn read_attachment_data_url(
    state: AppStateRef<'_>,
    note_rel_path: String,
    img_rel_path: String,
) -> Result<String> {
    blocking(&state, move |s| {
        s.vault
            .read_attachment_data_url(&note_rel_path, &img_rel_path)
    })
    .await
}

// --- Search --------------------------------------------------------------------

#[tauri::command]
pub async fn search_notes(state: AppStateRef<'_>, query: String) -> Result<Vec<SearchResult>> {
    blocking(&state, move |s| s.search.search(&query, SEARCH_LIMIT)).await
}

/// Links that may point at `path` (same file name); the frontend resolves them.
#[tauri::command]
pub async fn backlinks(state: AppStateRef<'_>, path: String) -> Result<Vec<LinkRef>> {
    blocking(&state, move |s| s.search.backlinks(&path)).await
}

/// Exact search (case-sensitive / regex), line by line, honouring `tag:`/`path:`.
#[tauri::command]
pub async fn grep_notes(
    state: AppStateRef<'_>,
    query: String,
    case_sensitive: bool,
    regex: bool,
    whole_word: bool,
) -> Result<GrepResult> {
    let opts = GrepOptions {
        case_sensitive,
        regex,
        whole_word,
    };
    blocking(&state, move |s| s.search.grep(&query, opts)).await
}

/// Replaces matches in the previewed notes; see `AppState::replace_in_notes`.
#[tauri::command]
pub async fn replace_in_notes(
    state: AppStateRef<'_>,
    query: String,
    case_sensitive: bool,
    regex: bool,
    whole_word: bool,
    replacement: String,
    targets: Vec<ReplaceTarget>,
) -> Result<Vec<ReplaceOutcome>> {
    let opts = GrepOptions {
        case_sensitive,
        regex,
        whole_word,
    };
    blocking(&state, move |s| {
        s.replace_in_notes(&query, opts, &replacement, &targets)
    })
    .await
}

/// Every tag in the vault with its note count.
#[tauri::command]
pub async fn all_tags(state: AppStateRef<'_>) -> Result<Vec<TagCount>> {
    blocking(&state, |s| s.search.all_tags()).await
}

/// Notes carrying `tag` or a tag nested under it.
#[tauri::command]
pub async fn notes_with_tag(state: AppStateRef<'_>, tag: String) -> Result<Vec<String>> {
    blocking(&state, move |s| s.search.notes_with_tag(&tag)).await
}

/// Notes mentioning `phrase` (a note title) in their text.
#[tauri::command]
pub async fn mentions(state: AppStateRef<'_>, phrase: String) -> Result<Vec<SearchResult>> {
    blocking(&state, move |s| s.search.mentions(&phrase, SEARCH_LIMIT)).await
}

#[tauri::command]
pub async fn quick_switch(state: AppStateRef<'_>, query: String) -> Result<Vec<String>> {
    blocking(&state, move |s| s.search.quick_switch(&query, SEARCH_LIMIT)).await
}

// --- GitHub sync -----------------------------------------------------------------

#[tauri::command]
pub async fn get_sync_settings(state: AppStateRef<'_>) -> Result<SyncSettings> {
    blocking(&state, |s| s.get_sync_settings()).await
}

#[tauri::command]
pub async fn configure_sync(
    state: AppStateRef<'_>,
    repo_url: String,
    branch: String,
    auth_method: String,
) -> Result<()> {
    blocking(&state, move |s| {
        s.configure_sync(&repo_url, &branch, &auth_method)
    })
    .await
}

/// Stores the PAT in the OS keychain (never written to disk).
#[tauri::command]
pub async fn set_github_pat(state: AppStateRef<'_>, pat: String) -> Result<()> {
    blocking(&state, move |_| gitsync::set_pat(&pat)).await
}

#[tauri::command]
pub async fn sync_now(state: AppStateRef<'_>) -> Result<()> {
    blocking(&state, |s| s.sync.sync()).await
}

#[tauri::command]
pub fn get_sync_status(state: AppStateRef<'_>) -> Status {
    state.sync.status()
}

// --- Lifecycle ---------------------------------------------------------------------

/// Quits the app after a final, time-limited sync (title bar Ctrl+click on
/// close). Replaces Wails' runtime Quit, which ran OnShutdown.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    lifecycle::graceful_quit(&app);
}

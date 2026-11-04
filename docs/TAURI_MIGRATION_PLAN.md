# Logledge — Wails v2 → Tauri v2 Migration Plan

Goal: replace the tech stack (Wails v2 + Go) with Tauri v2 + Rust, following the
same structure and build/release approach as `xmark`, while keeping every
existing feature and user-visible behavior.

## 1. Summary

**Feasible, medium effort.** The Go backend that must actually be rewritten in
Rust is ~2,000 LOC (`vault`, `gitsync`, `search`, `watcher`, `config`,
`updater`, `app.go`). Two packages can be dropped entirely because Tauri
provides them:

- `internal/tray` (406 lines of raw Win32) → Tauri built-in tray, which also
  works on macOS and Linux.
- `internal/reveal` → `revealItemInDir` from `tauri-plugin-opener`.

The frontend (React + CodeMirror) stays almost untouched: only the 38 bound
methods and a handful of runtime APIs change.

Estimate: **~8–12 working days** for one developer, excluding manual QA on all
three OSes.

## 2. Current State

| | logledge (current) | xmark (reference) |
|---|---|---|
| Layout | `frontend/` + Go at repo root | `src/` at root + `src-tauri/` |
| Backend calls | Generated `wailsjs/` (classes with `createFrom`) | Manual `invoke()` |
| Settings storage | Go writes `config.json` | `plugin-store` |
| Update check | Go (`internal/updater`) | Frontend `fetch` |
| Release | release-please + `wails build` + custom packaging | github-tag-action + `tauri-action` |
| Vite / TS | Vite 7, TS 5, Tailwind 4 | Vite 8, TS 6, Tailwind 3 |

## 3. Backend Mapping (Go → Rust / Tauri)

| Go | Rust / Tauri | Notes |
|---|---|---|
| `wails.Run` + `options.App` | `tauri::Builder`, `tauri.conf.json` | `decorations: false`, 1024×768 |
| `SingleInstanceLock` | `tauri-plugin-single-instance` | Callback shows + unminimizes the window |
| `HideWindowOnClose` | `WindowEvent::CloseRequested` → `prevent_close()` + `hide()` | |
| `OnShutdown` (final sync, 8s timeout) | `RunEvent::ExitRequested` → `prevent_exit()` → sync with timeout → `app.exit(0)` | Risk R3 |
| `internal/tray` | `tauri::tray::TrayIconBuilder` + `Menu` | Rebuild vi/en labels on language change |
| `internal/vault` | `std::fs`, `walkdir`, `trash` crate | Keep path-traversal guard, worktree lock, `WriteFileIfUnchanged` |
| `internal/watcher` (fsnotify) | `notify` + 300ms debounce + 2s suppress map | `notify` is natively recursive; ignore `.git` |
| `internal/gitsync` | `std::process::Command` running `git`, `creation_flags(CREATE_NO_WINDOW)` on Windows | Port as-is: fetch → autoCommit → ff / merge `-X ours` → conflict rename → push |
| `go-keyring` | `keyring` crate | Compatibility risk R2 |
| `internal/search` (modernc sqlite FTS5) | `rusqlite` with `bundled` (FTS5 enabled) | Same SQL and `snippet()`; existing index files stay readable |
| `sahilm/fuzzy` | `nucleo-matcher` or `fuzzy-matcher` | Ranking will differ slightly |
| `internal/config` | `serde_json` + `dirs::config_dir()/logledge/config.json` | Do **not** use Tauri `app_config_dir()` (different path, loses old config) |
| `internal/updater` + `update.go` | Move to TypeScript like xmark | Keep draft/prerelease skip, `safeReleaseURL`, prerelease ordering |
| `internal/reveal` | opener `revealItemInDir` | Drop the package |
| Goroutines + 5-minute periodic sync | `tauri::async_runtime::spawn` + `tokio::time::interval`, stop via `JoinHandle::abort` | |

## 4. Frontend Mapping (Wails runtime → Tauri)

| Wails | Tauri |
|---|---|
| `wailsjs/go/main/App` (38 functions) | Hand-written `src/lib/api.ts` wrapping `invoke`, **same function names** so components only change the import path |
| `wailsjs/go/models` (`new config.VaultEntry`, `vault.Node.createFrom`) | Plain TS interfaces in `src/lib/types.ts`; fix the 5 call sites using `new …` / `createFrom` |
| `EventsOn` (returns unsubscribe synchronously) | `listen()` returns `Promise<UnlistenFn>`; update cleanup in 4 `useEffect`s |
| `--wails-draggable: drag/no-drag` | `data-tauri-drag-region` |
| `WindowMinimise/ToggleMaximise/Hide`, `Quit` | `getCurrentWindow().minimize()/toggleMaximize()/hide()`, `quit_app` command (runs the final sync; see Phase 3 notes) |
| `WindowSetDark/Light/SystemDefaultTheme` | `getCurrentWindow().setTheme('dark' \| 'light' \| null)` |
| `BrowserOpenURL` | `openUrl` from `plugin-opener` |
| `ClipboardSetText` | `navigator.clipboard.writeText` (verified in Phase 0) |
| `PickVaultFolder` (Go-side dialog) | `plugin-dialog` `open({directory: true})`, or keep a Rust command |

## 5. Risks

| # | Risk | Level | Mitigation |
|---|---|---|---|
| R1 | **HTML5 drag-and-drop breaks.** On Windows Tauri intercepts drops by default, breaking image drop into the editor and FileTree drag-and-drop | High | Set `"dragDropEnabled": false` on the window; verify in Phase 0 |
| R2 | **Stored PAT lost.** go-keyring on Windows uses target `logledge:github-pat` with a UTF-8 blob; `keyring-rs` defaults to a different target and a UTF-16 blob. Linux attributes also differ | High | `Entry::new_with_target("logledge:github-pat", "logledge", "github-pat")`, read via `get_secret()` and decode UTF-8, write back in the same format. Spike against a real PAT from the Wails build |
| R3 | **Sync on exit.** `ExitRequested`, tray "Quit" and Ctrl+click on close must share one path; easy to hang or exit twice | Medium | Single `graceful_quit()` guarded by an `AtomicBool`, sync on a separate thread with an 8s timeout |
| R4 | **Sync commands run on the main thread.** Non-`async` Tauri commands block the UI; git and reindex are slow | Medium | Make git/search/tree commands `async` or use `spawn_blocking` |
| R5 | **Concurrency semantics drift** (worktree lock, run lock, reindex cancel) | Medium | `Arc<Mutex>` (`parking_lot`); cancel reindex via an `AtomicU64` generation counter; port all of `gitsync_test` and `vault_test` |
| R6 | **Window drag behavior differs.** Tauri toggles maximize on double-click of a drag region; the current `onDoubleClick` would toggle twice. Children do not inherit the drag region | Medium | Remove `onDoubleClick`; check every TitleBar element |
| R7 | **Installer.** Wails NSIS writes uninstall key `LogledgeLogledge`; Tauri NSIS uses a different key and install dir → users end up with two installs | Medium | NSIS hook (`NSIS_HOOK_PREINSTALL`) that silently runs the old uninstaller, or document it in release notes |
| R8 | **localStorage lost** (theme, sidebar width, lang) because origin and WebView2 profile change | Low | Theme/lang are also in `config.json`; accept losing sidebar width |
| R9 | **Serialization differences.** Go nil slices → `null`, Rust empty `Vec` → `[]`; `omitempty` needs `skip_serializing_if` | Low | Audit frontend `null` checks; keep JSON field names (`gitRepoUrl`, `repoURL`, …) |
| R10 | **Ctrl+P result order** changes with a different fuzzy library | Low | Accept, or tune scoring |
| R11 | **`invoke` arg naming**: Tauri maps camelCase JS args to snake_case Rust params | Low | Keep one convention inside `api.ts` |
| R12 | **Version bumps**: xmark needs follow-up "sync Cargo.lock" commits after each release | Low | Set `tauri.conf.json` `"version": "../package.json"`; release-please bumps `package.json` + `Cargo.toml` (`toml` type) |

## 6. Implementation Plan

Work on branch `feature/tauri-migration`. Keep the Go code buildable until the
end of Phase 4 to compare behavior side by side.

### Phase 0 — Spikes (0.5–1 day)

- R2: read a PAT written by go-keyring using `keyring-rs` on Windows.
- R1: minimal Tauri window, drop an image into a textarea with `dragDropEnabled: false`.
- Open an existing FTS5 index file with `rusqlite` (`bundled`).
- If R2 fails: fall back to asking the user to re-enter the PAT once.

### Phase 1 — Project skeleton (1 day)

- `git mv frontend/* .` to match the xmark layout (keeps file history).
- Scaffold `src-tauri/` modeled on xmark's `Cargo.toml`,
  `capabilities/default.json`, `build.rs`, `main.rs` / `lib.rs`.
- `tauri.conf.json`: productName `Logledge`, identifier `com.logledge.app`,
  `decorations: false`, `dragDropEnabled: false`, icons from `build/`.
- Plugins: dialog, opener, single-instance (process dropped in Phase 3).
- Vite: `strictPort`, `clearScreen: false`, `__APP_VERSION__` like xmark; keep `@tailwindcss/vite`.
- Done when: `npm run tauri dev` shows the UI (no backend yet).

### Phase 2 — Backend core (3–4 days)

One commit per module, each with ported tests:

1. `config.rs` — same path and schema, default `FileFilter`.
2. `vault.rs` — `resolve` traversal guard, `Tree`, CRUD, `Copy` / `Duplicate` /
   `copyName`, trash, `WriteFileIfUnchanged`, attachments, data URLs. Port `vault_test.go`.
3. `watcher.rs` — `notify` + debounce + suppress, ignore `.git`.
4. `search.rs` — rusqlite FTS5, mtime-based reindex with cancellation,
   `ftsQuery`, `QuickSwitch`. Port `search_test.go`.
5. `gitsync/` — `run()` with `CREATE_NO_WINDOW`, `ensure_repo`, `sync`,
   `reconcile`, `merge_with_conflict_rename`, `split_nul`, `detect_git_info`,
   credentials. Port `gitsync_test.go` and `detect_test.go`. Highest-care module.
6. `state.rs` + `commands.rs` — `AppState` holding the services; 37 commands
   (`GetAppVersion` replaced by `__APP_VERSION__`); emit `vault:changed` and
   `sync:status` via `app.emit`.

### Phase 3 — App lifecycle (1–1.5 days)

- Tray (Open / Sync now / Quit, localized labels, left-click shows the window),
  hide-on-close, single-instance, `graceful_quit()` with the 8s final sync.
- 5-minute periodic sync, restarted on vault switch or sync settings change.

### Phase 4 — Frontend (1.5–2 days)

- Add `src/lib/api.ts` + `src/lib/types.ts`; delete `wailsjs/`.
- Update `TitleBar`, `useTheme`, `useVault`, `App.tsx`, `SyncStatusBar`,
  `Editor`, `SettingsModal`, `updateCheck`, `i18n`.
- Move the updater to `src/utils/updateCheck.ts` + `version.ts`, keeping the Go
  logic (draft/prerelease handling, safe release URL).
- Add `disableWebviewDefaults` like xmark, without blocking the app's own context menus.

### Phase 5 — CI/CD (1 day)

- `ci.yml`: Node build + `npm test` + `cargo fmt --check`, `cargo clippy`,
  `cargo test` (install `libwebkit2gtk-4.1-dev` etc. on Ubuntu).
- `release.yml`: **keep release-please** (generates CHANGELOG); replace the
  build job with `tauri-action` using xmark's matrix. Add macOS
  `universal-apple-darwin` to match the current universal build.
- `release-please-config.json`: drop `wails.json`, add `src-tauri/Cargo.toml`
  (`toml` type, `$.package.version`).
- NSIS hook to uninstall the old Wails build (R7).

### Phase 6 — Cleanup and QA (1–2 days)

- Remove `main.go`, `app.go`, `update.go`, `go.mod` / `go.sum`, `internal/`,
  `wails.json`, `build/` (keep source icons). Possibly remove the unused Python
  stub (`pyproject.toml`, `src/logledge/`) — to be confirmed.
- Update `README`, `.github/copilot-instructions.md`, `docs/PLAN.md`.
- Manual QA checklist on Windows / macOS / Linux:
  - open / switch vault; file tree CRUD; drag-and-drop
  - paste / drop images; auto-save when the file changes externally
  - Ctrl+P, Ctrl+Shift+F
  - sync via PAT and SSH; conflict; offline
  - tray; hide vs quit; single instance
  - theme; language; update toast
  - upgrade from Wails 0.5.0 keeps config and PAT
- Release as **0.6.0** or **1.0.0**, stating the stack change in release notes.

## 7. Open Decisions

1. **Layout**: move `frontend/` to the root like xmark (recommended), or keep `frontend/`?
2. **Release**: keep release-please (recommended, keeps CHANGELOG) or switch to
   github-tag-action like xmark?
3. **Update check**: frontend like xmark (recommended) or keep it in Rust?
4. **Settings**: keep self-managed `config.json` via `dirs` (recommended,
   backward compatible), or move to `plugin-store` like xmark (loses existing
   config without a migration step)?

## 8. Phase 0 Results

Spikes ran on Windows 11 with Rust 1.90, `keyring` 3.6.3, `rusqlite` 0.37
(`bundled`, SQLite 3.50 via `libsqlite3-sys` 0.35) and Tauri 2.11. Spike code
was throwaway and is not committed; the findings below are what Phase 2 relies on.

### R2: go-keyring credential interop (Windows): resolved

A dummy token containing non-ASCII characters was written with go-keyring
v0.2.8 (same code path as `gitsync.SetPAT`, under a separate service name so the
real `logledge` entry was never touched), then read from Rust:

| Read path | Result |
|---|---|
| `Entry::new(service, user).get_password()` | `NoEntry`: default target name differs |
| `Entry::new_with_target("<service>:<user>", ..).get_password()` | Found, but **wrong value** (decodes the UTF-8 blob as UTF-16) |
| `Entry::new_with_target("<service>:<user>", ..).get_secret()` + `String::from_utf8` | **Exact match** |

The reverse direction also works: `set_secret(pat.as_bytes())` on the same
target is read back unchanged by go-keyring. Phase 2 credentials therefore use:

```rust
fn pat_entry() -> keyring::Result<Entry> {
    if cfg!(windows) {
        Entry::new_with_target("logledge:github-pat", "logledge", "github-pat")
    } else {
        Entry::new("logledge", "github-pat")
    }
}
// read:  String::from_utf8(entry.get_secret()?)
// write: entry.set_secret(pat.as_bytes())
```

Existing PATs survive the upgrade; no "re-enter PAT" fallback is needed on
Windows. macOS (`security` service/account) and Linux (Secret Service
attributes) were not tested here and stay on the Phase 6 QA checklist.

### FTS5 index interop: resolved

An index created by `modernc.org/sqlite` with the exact schema and pragmas of
`internal/search` (WAL mode) opens in `rusqlite` with `bundled`. The original
`snippet(notes_fts, 1, '**', '**', '...', 10)` query, `ORDER BY rank` and the
`ftsQuery` quoting (`"tok"*`) return the same rows and highlights, including
Vietnamese text, and inserts into `files` / `notes_fts` succeed. Existing
indexes can be reused as-is; no forced rebuild on upgrade.

### R1: HTML5 drag-and-drop with `dragDropEnabled: false`: resolved

A minimal undecorated Tauri window (`dragDropEnabled: false`) was tested manually for:
1. Dropping an image file from Explorer onto a textarea (`dataTransfer.files` +
   `FileReader`), as `Editor.tsx` does.
2. HTML5 drag between list rows (`text/plain` payload), as `FileTree.tsx` does.
3. `getCurrentWindow().setTheme('dark' | 'light' | null)`.
4. `navigator.clipboard.writeText` (decides whether
   `plugin-clipboard-manager` is needed).
5. R6: double-click on a `data-tauri-drag-region` title bar toggles maximize
   natively (so `TitleBar`'s own `onDoubleClick` must go).

| # | Result |
|---|---|
| 1 | **Pass.** A PNG dropped from Explorer arrives in `dataTransfer.files` with name, MIME type and size; `FileReader` produces the base64 payload `SaveAttachment` expects |
| 2 | **Pass.** Row-to-row moves in both directions deliver the `text/plain` path |
| 3 | **Pass.** `setTheme('dark' \| 'light' \| null)` all succeed; replaces `WindowSet*Theme` |
| 4 | **Pass.** `navigator.clipboard.writeText` works: origin `http://tauri.localhost` is a secure context. `plugin-clipboard-manager` is **not** needed for copying |
| 5 | **Confirmed (R6).** Dragging the window by a `data-tauri-drag-region` title bar works. Double-clicking it never delivers a `dblclick` event to JS: Tauri's drag region consumes the mouse events and handles maximize natively. `TitleBar`'s `onDoubleClick={() => WindowToggleMaximise()}` would be dead code, so remove it; double-click is not toggled twice |

Phase 4 follow-up: `EditorContextMenu` pastes via `document.execCommand('paste')`;
check it in the Tauri webview and fall back to `navigator.clipboard.readText()`
if it is blocked.

### Phase 0 conclusion

No blocker found. Plan changes going into Phase 1:
- Drop `plugin-clipboard-manager`; use `navigator.clipboard`.
- `dragDropEnabled: false` is mandatory in `tauri.conf.json`.
- `TitleBar`: replace `--wails-draggable` with `data-tauri-drag-region` and
  drop `onDoubleClick`. Elements inside the bar that must not start a drag
  (vault switcher, buttons) simply omit the attribute. The maximize/restore
  icon is kept in sync by listening to `onResized` + `isMaximized()`.
- Credentials and search index stay backward compatible, so no migration step
  is needed for them.

## 9. Phase 1 Notes

- `frontend/` moved to the root with `git mv`. Wails still builds and runs in
  parallel: `wails.json` sets `"frontend:dir": "."` and `main.go` embeds `dist/`.
- The unused Python stub (`pyproject.toml`, `src/logledge/`) was removed
  because it collided with the frontend `src/`.
- `src-tauri/` is modeled on xmark. `tauri.conf.json` reads its version from
  `../package.json`, so release bumps only touch `package.json` and
  `Cargo.toml` (R12). Plugins registered: single-instance (first, focuses the
  running window), dialog, opener, process (removed again in Phase 3).
- `__APP_VERSION__` was not added: `src/version.ts` already reads the version
  from `package.json` at build time, which gives the same result.
- JS package for `plugin-dialog` is added in Phase 4 when
  the UI first calls them; only `@tauri-apps/api` and `plugin-opener` are
  needed now.
- `src/wailsShim.ts` is a **temporary** bridge: when `window.go` /
  `window.runtime` are absent (Tauri, or a plain browser on `npm run dev`) it
  maps the Wails runtime calls the UI uses onto Tauri window/event/opener APIs
  and makes every bound Go method reject. The UI boots to the vault picker.
  `WindowHide` minimizes until the tray exists (Phase 3). Deleted in Phase 4
  together with `wailsjs/`.

## 10. Phase 2 Notes

- Rust backend under `src-tauri/src/`: `config`, `watcher`, `vault`, `fuzzy`,
  `search`, `gitsync/` (`mod`, `detect`, `credentials`), `state` (port of
  `app.go`), `commands`, plus a string-backed `error::Error` that reaches the
  frontend as a plain message like Wails errors did. 65 tests cover the ported
  Go tests and the JSON shapes the UI relies on.
- Watcher was ported before vault because the vault depends on it.
- **R10 resolved**: instead of `nucleo-matcher`, `sahilm/fuzzy` was ported
  line by line; its tests compare scores and order with reference output
  generated by the Go library, so Ctrl+P ranking is unchanged.
- **Security fix vs Go**: git error messages now redact the PAT. The Go build
  put the token-bearing fetch/push URL into error text shown in the status bar.
- Index files keep Go's name (`hex(sha256(root)[:8]).sqlite`) and mtime unit
  (Unix nanoseconds), so existing indexes are reused without a rebuild.
- 36 commands: the Go `App` methods in snake_case with the same arguments.
  All run via `spawn_blocking`, so file, git and SQLite work never blocks the
  UI thread (R4). `GetAppVersion` and `CheckForUpdate` are not ported; Phase 4
  moves the update check to the frontend.
- State tests use a fake PAT lookup and local unreachable remotes with auth
  `none`, so they never read the real keychain token or hit the network. The
  credentials test uses the separate service `logledge-test`.
- The UI still talks to the Phase 1 shim; the commands are first exercised
  end to end in Phase 4.

## 11. Phase 3 Notes

- `tray.rs`: Open / Sync now / Quit with vi/en labels; left click shows the
  window, right click opens the menu. Labels follow `save_app_settings`
  without a restart. Uses Tauri's built-in tray (`tray-icon` feature), so it
  now also works on macOS and Linux (the Go tray was Windows only).
- `lifecycle.rs`: closing the main window hides it (Wails `HideWindowOnClose`).
  Every quit path (tray Quit, title bar Ctrl+click via the new `quit_app`
  command, OS-initiated exit such as Cmd+Q) goes through `graceful_quit()`:
  hide the window, stop periodic sync, run one final sync capped at 8 s, then
  exit. An `AtomicBool` makes it run once and lets our own exit through (R3).
- `tauri-plugin-process` was removed: a frontend `exit()` would skip the final
  sync, so quitting is only possible through `quit_app`.
- Periodic 5-minute sync was already done in Phase 2 (`AppState::apply_sync`
  restarts it on vault switch and sync settings change).
- Same limitation as the Go build: if the final sync exceeds 8 s, the process
  exits while git may still be running, which can leave `.git/index.lock`.
- The shim's `WindowHide` now really hides to the tray and `Quit` calls
  `quit_app`.


## 12. Phase 4 Notes

- `src/lib/api.ts`: one typed wrapper per Tauri command (camelCase names,
  argument keys matching the Rust parameters) plus `onEvent()`, which returns a
  synchronous unsubscribe so effects can return it directly, even before
  Tauri's async `listen` has resolved. `src/lib/types.ts` replaces the Wails
  model classes with plain interfaces (`vault.Node` became `VaultNode` to
  avoid clashing with the DOM `Node` type).
- `wailsjs/` and the Phase 1 shim are deleted. The title bar uses
  `data-tauri-drag-region` on the header only, which matches the old
  `--wails-draggable` layout (the three child sections were `no-drag`), and
  Tauri's own double-click maximize replaces the React `onDoubleClick`. The
  maximize icon now updates on `onResized` instead of 500 ms polling.
- Native theme via `getCurrentWindow().setTheme()`; links via
  `plugin-opener`'s `openUrl`; copy-path via `navigator.clipboard`.
- Update check ported to `src/lib/updater.ts` with the Go behaviour: drafts
  and pre-releases are ignored, pre-release-aware version comparison, and the
  release link falls back to the releases page unless it points at this repo.
  `test-updater.mjs` ports `updater_test.go` and runs in `npm test`.
- `src/lib/disableWebviewDefaults.ts` (from xmark) blocks the native context
  menu and reload shortcuts (F5, Ctrl/Cmd+R), which would drop unsaved editor
  content; the app's own context menus are unaffected.

## 13. Phase 5 Notes

- `ci.yml`: a frontend job (`npm run build`, `npm test`) and a Rust job on
  `ubuntu-22.04` and `windows-latest` (`cargo fmt --check` on Linux,
  `cargo clippy --all-targets -D warnings`, `cargo test`). The frontend is
  built first because `generate_context!` needs `dist/`. The keychain
  round-trip test is skipped on Linux, where the runner has no Secret Service.
- `release.yml`: release-please is unchanged (CHANGELOG, tag, release); the
  build job now runs `tauri-action`, which uploads the bundles to that release
  (or creates it for a manual `v*` tag push or `workflow_dispatch`). Matrix:
  Windows x64 (NSIS only), macOS `universal-apple-darwin`, Linux x64
  (`.deb`, `.rpm`, `.AppImage`).
- `test-build.yml`: same matrix, uploads the bundles as workflow artifacts.
- Asset changes vs. the Wails release: no portable Windows `.exe` or raw Linux
  binary and no `.sha256` files; macOS ships a `.dmg` and `.app.tar.gz`
  instead of a zipped `.app`.
- `release-please-config.json`: `wails.json` replaced by
  `src-tauri/Cargo.toml` (`toml`, `$.package.version`). `tauri.conf.json`
  reads its version from `package.json`, which release-please already bumps.
- R7: `src-tauri/windows/hooks.nsh` (`NSIS_HOOK_PREINSTALL`) looks up the
  Wails uninstall key `...\Uninstall\LogledgeLogledge` (HKLM, then HKCU) and
  runs that uninstaller silently via `ExecShellWait`, so Windows can raise the
  UAC prompt the old admin-level uninstaller needs. It removes the old program
  files and shortcuts only; `config.json` and the keychain PAT stay. MSI is
  not built because it cannot run this hook.

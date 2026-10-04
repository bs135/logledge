# Logledge — Implementation Plan

## 1. Overall Feasibility Assessment

The concept is feasible. Wails v2 (Go + React/TS, utilizing the native OS WebView instead of bundling Chromium) is the right choice to achieve <1s cold-start, <80MB RAM, and <30MB binary size — this is Wails' core advantage over Electron. The local-first architecture, independent `.md` files, and Git-based synchronization is a proven model (Obsidian + Git plugin, Foam, etc.).

However, several aspects in the original specification carried high risks if implemented 100% as initially described — adjustments were made after consultation:

| Item | Original Spec | Adjusted | Rationale |
|---|---|---|---|
| Sync engine | Pure Go `go-git` | System `git` CLI via `os/exec` | `go-git` lacks robust rebase/3-way merge support; reimplementing it carries high bug risks. Using real git is much more stable, and the target audience (developers) almost always has git installed. The app still fully automates all operations without requiring users to type commands. |
| Editor | Split-view + WYSIWYG (2 modes) | Single mode: WYSIWYG Live Preview (Obsidian-style) via Milkdown | Reduces editor complexity by ~50%, avoiding parallel synchronization of two states (raw text ⇄ AST). |
| PAT storage | Not specified | OS Keychain via `zalando/go-keyring` | Prevents storing tokens in plaintext on disk. |
| Roadmap | "TBD" | Divided into 6 sequential phases, each independently runnable | Scope is too large for a single pass; requires clear testing milestones. |

### Risks/Assumptions to Verify Early (validated via small spikes at the beginning of Phase 1)
- **FTS5 in `modernc.org/sqlite`:** This library is a pure-Go translation of the SQLite amalgamation (no CGO required) with FTS5 support — verified with a small test before depending on the full Search Engine.
- **WebView2 on Windows:** Wails requires the WebView2 Runtime; recent Windows 10/11 versions typically have it pre-installed, but a bootstrapper installer is required for machines lacking it.
- **Binary size under 30MB:** Feasible with Wails (typically 5–15MB), but requires monitoring when adding pure-Go SQLite (which increases size noticeably due to transpiled C amalgamation) — re-measured at the end of each phase.
- **Cold-start < 1s:** Must not block the UI with full re-indexing or `git pull` on startup — must run in background goroutines, displaying the file tree immediately while indexing/syncing runs asynchronously and progressively updates the UI.
- **fsnotify self-trigger loops:** Requires a mechanism to ignore events written by the app itself (a self-write registry with timestamp/hash) to prevent the watcher from reacting to its own auto-saves.

## 2. Updated Architecture

```
+-------------------------------------------------------------+
|                   Frontend (WebView - React/TS)              |
|  - UI: React + TailwindCSS                                   |
|  - Editor: Milkdown (WYSIWYG Live Preview only)               |
|  - File Tree, Command Palette (Ctrl+P), Global Search (Ctrl+Shift+F) |
|  - Status bar: Sync state (Synced/Syncing/Conflict/Offline)  |
+------------------------------+--------------------------------+
                               | Wails auto-generated bindings (JSON-RPC over IPC)
+------------------------------v--------------------------------+
|                        Backend (Go)                            |
|  - VaultService: CRUD file/folder, trash (OS recycle bin)      |
|  - Watcher: fsnotify + self-write suppression + debounce       |
|  - EditorService: debounced write-to-disk (500-1000ms)         |
|  - AttachmentService: clipboard image -> .attachments/         |
|  - SearchService: modernc.org/sqlite FTS5, background indexer  |
|  - SyncService: os/exec("git", ...) wrapper, PAT via go-keyring|
|  - ConflictResolver: diff local/remote per file, rename-on-conflict |
+-----------------------------------------------------------------+
```

## 3. Phased Roadmap (each phase = 1 runnable/testable milestone)

**Phase 0 — Scaffold & Spike**
- `wails init` (React-TS template), directory structure, TailwindCSS.
- Spike verifying FTS5 works in `modernc.org/sqlite`.
- Basic CI: `go build`, `go vet`, `npm run build`.

**Phase 1 — Vault & File Tree (MVP)**
- Select/initialize Vault directory, persist config (vault path) locally.
- VaultService: list nested file tree, create/rename/delete (OS trash)/drag-and-drop move files and folders.
- fsnotify watcher for two-way synchronization with UI, including self-write suppression.
- Sidebar tree UI (React) + non-blocking loading state for cold-start.

**Phase 2 — Markdown Editor**
- Integrate Milkdown in WYSIWYG Live Preview mode (CommonMark + GFM: tables, task lists, strikethrough, code blocks with syntax highlighting).
- Auto-save debounce 500–1000ms, no Ctrl+S required.
- Paste image from clipboard → save to `.attachments/`, insert relative Markdown link.

**Phase 3 — Full-Text Search**
- SearchService using SQLite FTS5, background indexing (goroutines) on app startup / file change.
- Quick Switcher (`Ctrl+P`, fuzzy filename search).
- Global Search (`Ctrl+Shift+F`) with snippet extraction + keyword highlighting.

**Phase 4 — GitHub Sync Engine**
- Repository configuration (URL, branch, PAT or SSH) — PAT stored in OS Keychain via `go-keyring`.
- SyncService using system `git` CLI (`os/exec`): pull --rebase on app startup, periodic auto commit+push/on exit, manual sync button.
- Status bar displaying Synced/Syncing/Conflict/Offline.
- Conflict handling: detect divergence, compare per file — if changed on one side only, adopt that version; if changed on both sides, rename local to `Name.conflict.[timestamp].md` and pull remote version.

**Phase 5 — Packaging & Non-Functional Optimization**
- Measure & optimize cold-start (<1s), idle RAM (<80MB), binary size (<30MB) on Windows/macOS/Linux.
- Build/sign/package installer (NSIS/DMG/AppImage depending on platform via Wails build).
- Polish UX, keyboard shortcuts, and finalize documentation.

## 5. Implementation Results (Progress Update)

**Phase 0 — DONE**
- Scaffolded Wails v2 (`react-ts` template) + TailwindCSS v4 (via `@tailwindcss/vite`).
- Spike confirmed **FTS5 works in `modernc.org/sqlite`** (test `internal/search/fts5_spike_test.go` passed) — the highest risk of Phase 3 was resolved early.
- Basic CI (`.github/workflows/ci.yml`): `go build`/`vet`/`test` + `npm run build`.
- Measured baseline binary size: **~11.5MB** (within 30MB budget) — ample room left for sqlite/go-git/go-keyring in subsequent phases.

**Phase 1 — DONE**
- `internal/config`: stores Vault path at `%AppData%/logledge/config.json` (or OS equivalent on macOS/Linux).
- `internal/watcher`: recursive fsnotify across entire vault, 300ms debounce, `Suppress()` mechanism to prevent watcher from self-reacting to app's own operations.
- `internal/vault`: VaultService — Tree/CreateFile/CreateFolder/Rename/Move/Delete (OS recycle bin deletion via `Bios-Marcel/wastebasket/v2`, no CGO required)/ReadFile/WriteFile; path traversal protection; hides `.git` and dotfiles from tree. Unit tests passing (`go test ./internal/vault/...`).
- `app.go`: exposed methods via Wails bindings + emitted `vault:changed` event on file tree updates.
- Frontend: `useVault` hook, `FileTree` component (collapsible nested tree, right-click context menu for New note/New folder/Rename/Delete, drag-and-drop movement), `App.tsx` with Vault selection screen + textarea placeholder (auto-save debounced 600ms, replaced with Milkdown in Phase 2).
- Production build verified (`wails build`): cold-start ~1.0s, idle RAM **~67MB** (below 80MB budget; WebView2 accounts for the majority of this footprint).

**Phase 2 — DONE**
- Editor uses `@milkdown/crepe` (WYSIWYG Live Preview, built on Milkdown/ProseMirror) — natively supports CommonMark+GFM (tables, task lists, strikethrough), code block syntax highlighting (CodeMirror feature enabled by default), LaTeX, and link tooltips — satisfying Obsidian-style requirements without custom plugin assembly.
- `frontend/src/components/Editor.tsx`: mounts/unmounts Crepe using `key={selectedPath}` on file switch; listens to `markdownUpdated`, debounces 600ms, and calls `WriteFile` (auto-save without Ctrl+S).
- Image paste/drag-and-drop: uses Crepe's built-in `ImageBlock.onUpload` → encodes file to base64 on frontend → backend `SaveAttachment` (unit-tested) saves to `.attachments/` at Vault root, returning relative Markdown link based on current note path.
- Production build successful; binary size increased to **~15.4MB** (well under 30MB budget) after embedding Milkdown + CodeMirror language packs (code-split by language, loaded on demand).
- Known limitation: current environment cannot automate GUI typing/pasting in WebView (no GUI driver available) — verified via backend build/tests + successful app startup; manual verification recommended for interactive typing and image pasting.

**Phase 3 — DONE**
- `internal/search`: SearchService uses SQLite FTS5 (`files` table stores mtime for incremental re-indexing; `notes_fts` virtual table shares rowid with `files` to eliminate ambiguity on delete/overwrite). Index is stored **outside the Vault** (user cache directory, keyed by hash of Vault path) to avoid bloating or polluting Git repository in Phase 4.
- `Reindex()` runs in background goroutines, automatically skips if an indexing run is already in progress; triggered on Vault open and on watcher change events (`emitVaultChanged`) — non-blocking for cold-start and typing.
- `Search(query)`: FTS5 MATCH with per-word prefix search, returns highlighted `snippet()` enclosed in `**...**`. `QuickSwitch(query)`: fuzzy filename matching via `github.com/sahilm/fuzzy`.
- Unit tests: indexing/search, updates on file modification, removal on deletion, fuzzy matching — all passing.
- Frontend: `QuickSwitcher.tsx` (`Ctrl+P`) and `GlobalSearch.tsx` (`Ctrl+Shift+F`) — overlays with input, keyboard navigation (↑/↓/Enter/Esc), Global Search displays snippets with `<mark>` highlighting.
- Production build successful; binary size **~19.2MB** (~4MB increase due to embedding `modernc.org/sqlite` into app binary) — remains well below 30MB budget.

**Phase 4 — DONE**
- `internal/gitsync`: SyncService directly invokes system `git` CLI via `os/exec` (matching design decision) — avoids go-git and custom merge/rebase algorithms.
- **Key adjustment from original spec:** Instead of `git pull --rebase`, uses `git fetch` + `git merge --no-commit --no-ff -X ours`, then applies manual rename-on-conflict policy strictly to files modified on BOTH sides. Rationale: rebasing periodic "Auto-sync" commits combined with rename-on-conflict is error-prone; a single merge achieving the same end result (no `<<<<<<<`, preserved two-branch history, fully automated) carries significantly lower risk. Verified with unit tests: clean remote fast-forward, 2-sided edits on different files (clean merge), and genuine conflict (renamed to `.conflict.<timestamp>.md`, no conflict markers, subsequent sync is a no-op) — all passing against real local bare Git repositories.
- PAT stored via `github.com/zalando/go-keyring` (Windows Credential Manager / macOS Keychain / Linux Secret Service) — never written to `.git/config` or any file on disk; temporarily injected into URL parameter for each `git fetch`/`git push` execution. Verified with real round-trip smoke test on Windows Credential Manager.
- Sync triggers: on Vault open (if configured), every 5 minutes while running, on app shutdown (`OnShutdown`, with 8s timeout to prevent hanging exit), and manual sync button/status bar.
- Frontend: `SyncStatusBar` (status icons: Synced/Syncing/Conflict/Offline/Error/Not configured, click to sync) + `SyncSettingsModal` (repo URL, branch, authentication method, PAT — PAT is write-only, never displayed again).
- Production build successful; binary size **~19.25MB** (virtually unchanged from Phase 3, since go-keyring is lightweight and git CLI runs externally) — leaving ~10.7MB headroom under 30MB limit.
- Known limitation: stores one global PAT per machine (sufficient for typical 1 Vault / 1 GitHub account per machine); go-keyring round-trip verified on Windows, recommended to test on macOS/Linux during Phase 5 packaging.

**Phase 5 — DONE (within sandbox environment constraints)**
- `README.md` fully rewritten: overview, phased features, keyboard shortcuts, dev/build/test guide, directory structure, sync implementation notes, measured NFR table.
- `.github/workflows/release.yml`: cross-platform builds and packaging (Windows NSIS, macOS universal dmg, Linux AppImage) on `v*` tag push via `dAppServer/wails-build-action`.
- **Important environment constraint**: NSIS installer cannot be generated locally in this sandbox — `wails build -nsis` reported "makensis not found", and installing NSIS via `winget` was blocked due to lack of admin permissions (error `0x800704c7`, elevation denied); direct download of portable NSIS from SourceForge also returned HTML instead of zip. Therefore, **NSIS installer and macOS/Linux builds have not been directly tested locally in this session** — verification should be performed via CI (`release.yml`) or on a machine with administrative privileges.
- Fully verified on Windows: `wails build` (portable exe) succeeds, full Go + frontend builds and tests pass, cold-start ~1s, idle RAM 35–67MB, binary size ~19.25MB — all within targeted NFR budgets.

## 6. Finalized Decisions
- Sync: Use system `git` CLI (`os/exec`); do not reimplement git via go-git.
- Editor: Single WYSIWYG Live Preview mode (Milkdown); do not implement split raw-markdown view.
- PAT Security: OS Keychain (`go-keyring`).
- Methodology: Sequential phased delivery as outlined above, starting Phase 0 + Phase 1 upon plan approval.


# Logledge

A desktop, local-first note-taking application based on plain `.md` files — synchronized across devices via GitHub. Built with [Wails v2](https://wails.io) (Go backend + React/TypeScript frontend).

## Objectives

- **Data Sovereignty**: Every note is an independent `.md` file on disk, free from proprietary formats or server lock-in.
- **Developer-Focused**: Fast startup, lightweight footprint, keyboard shortcuts, and Obsidian-style Markdown WYSIWYG editing.
- **Automated Git Sync**: Effortless synchronization without requiring manual CLI operations.

## Features (by Development Phase)

| Phase | Description |
|---|---|
| 0 | Scaffold Wails + TailwindCSS, basic CI |
| 1 | Vault & File Tree: Vault folder selection, nested file tree, create/rename/delete (OS recycle bin)/drag-and-drop, live sync with external filesystem changes (fsnotify) |
| 2 | Markdown Editor: WYSIWYG Live Preview (Milkdown/Crepe) — CommonMark+GFM, code block syntax highlighting, LaTeX; 600ms debounce auto-save; clipboard image paste into `.attachments/` |
| 3 | Full-Text Search: SQLite FTS5, Quick Switcher (`Ctrl+P`, fuzzy filename matching), Global Search (`Ctrl+Shift+F`, full-text with highlighted snippets) |
| 4 | GitHub Sync Engine: Automated synchronization (on app launch / every 5 minutes / on exit / manual), PAT securely stored in OS Keychain, conflict resolution via file renaming instead of conflict markers |

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+P` | Quick Switcher — fast fuzzy search by filename |
| `Ctrl+Shift+F` | Global Search — full-text search across the Vault |
| Right-click on File Tree | New note / New folder / Rename / Delete |
| Drag-and-drop on File Tree | Move file/folder |

There is no save shortcut (`Ctrl+S`) — all changes are automatically saved (debounced ~600ms).

## Development

Requirements: Go 1.25+, Node 20+, [Wails CLI v2](https://wails.io/docs/gettingstarted/installation).

```bash
# Run in development mode (hot-reloads frontend via Vite)
wails dev

# Build production binary
wails build

# Build with NSIS installer (Windows)
wails build -nsis
```

Backend testing:

```bash
go build ./...
go vet ./...
go test ./...
```

Frontend verification:

```bash
cd frontend
npx tsc --noEmit
npm run build
```

## Cross-Platform Packaging

`.github/workflows/release.yml` builds and packages artifacts for Windows (NSIS), macOS (universal, dmg), and Linux (AppImage) when pushing tags matching `v*`, using [`dAppServer/wails-build-action`](https://github.com/dAppServer/wails-build-action).
Building and testing for macOS and Linux, as well as creating the Windows NSIS installer, requires running on CI (or a machine with administrative privileges) — the local sandbox environment lacks permissions to install NSIS locally, so only the portable `.exe` is built and verified locally.

## Measured Non-Functional Requirements (Windows Dev Machine)

| Metric | Target | Measured |
|---|---|---|
| Cold-start | < 1s | ~1.0s |
| Idle RAM | < 80MB | ~35–67MB |
| Binary size (portable exe) | < 30MB | ~19.3MB |

## GitHub Sync — Implementation Notes

- Synchronization uses the system `git` CLI via `os/exec` (instead of go-git) — requires Git installed on the user's system.
- Instead of a literal `git pull --rebase`, the engine uses `git fetch` + `git merge --no-commit --no-ff -X ours`, then applies a conflict renaming strategy (`Name.conflict.<timestamp>.md`) exclusively to files modified on both sides. This avoids inserting `<<<<<<<` conflict markers into notes while maintaining proper branch merge history — see Phase 4 commit history for rationale.
- Personal Access Tokens (PAT) are never written to disk in plaintext — they are stored securely in the OS Keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service via `go-keyring`).

## Directory Structure

```
app.go                  # Wails App: bridge between backend services and frontend
main.go                 # Entry point, configures Wails options
internal/
  config/               # Application configuration (Vault path, sync settings)
  vault/                 # VaultService: file/folder CRUD, attachments
  watcher/               # fsnotify wrapper (debounce + self-write suppression)
  search/                # SearchService: SQLite FTS5, Quick Switcher, Global Search
  gitsync/               # SyncService: GitHub sync via git CLI + go-keyring
frontend/
  src/components/        # FileTree, Editor, QuickSwitcher, GlobalSearch, Sync UI
  src/hooks/              # useVault hook
```

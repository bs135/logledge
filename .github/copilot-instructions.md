# Copilot Instructions for Logledge

This repository contains **Logledge**, a desktop, local-first note-taking application based on plain `.md` files synchronized across devices via GitHub.

---

## 1. Project Overview & Philosophy

- **Local-First & Data Sovereignty**: Notes are stored directly as plain `.md` files in a local directory (Vault) on the user's disk. Do not store note content in proprietary formats or internal databases; SQLite is used strictly for secondary indexing (FTS5).
- **Desktop Performance Targets**:
  - Cold-start: `< 1s` (never block startup or UI mount on heavy tasks like sync or re-indexing).
  - Idle RAM: `< 80MB`.
  - Binary size: `< 30MB` (portable executable).
- **CGO-Free Architecture**: The Go backend must compile cleanly with `CGO_ENABLED=0` to support fast and reliable cross-platform builds across Windows, macOS, and Linux.

---

## 2. Technology Stack

### Backend (Go 1.25+)
- **Application Framework**: [Wails v2](https://wails.io) (`github.com/wailsapp/wails/v2`).
- **Database / Full-Text Search**: `modernc.org/sqlite` (pure Go SQLite with FTS5 enabled, no CGO).
- **Filesystem Watcher**: `github.com/fsnotify/fsnotify` with debounce and self-write suppression.
- **Git Sync Engine**: System `git` CLI invocation via `os/exec` (with OS-specific window suppression on Windows).
- **Credential Storage**: OS Keychain / Credential Manager via `github.com/zalando/go-keyring`.
- **Trash / Recycle Bin**: `github.com/Bios-Marcel/wastebasket/v2`.
- **Fuzzy Matching**: `github.com/sahilm/fuzzy`.
- **System Tray**: `github.com/getlantern/systray` (pure Go Windows API).

### Frontend (Node.js 24+, React 19, TypeScript)
- **Framework & Bundler**: React 19, TypeScript 5.6+, Vite 7.
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`), CSS custom variants for dark mode, custom fonts (`Nunito`).
- **Markdown Editor**: [Milkdown Crepe](https://milkdown.dev) (`@milkdown/crepe`) in WYSIWYG Live Preview mode.
- **Icons**: `lucide-react`.
- **Internationalization (i18n)**: English (`en`) and Vietnamese (`vi`) in `frontend/src/i18n/index.ts`.

---

## 3. Directory Structure

```
├── main.go                     # Entry point, Wails configuration, frameless window, single instance lock
├── app.go                      # Wails App struct: bridge between Go backend services and frontend
├── internal/
│   ├── config/                 # Application configuration (multi-vault, active vault, theme, language, sync)
│   ├── gitsync/                # Git sync engine, git CLI execution, credentials via go-keyring
│   ├── search/                 # SQLite FTS5 indexer, Quick Switcher fuzzy search, Global Search
│   ├── tray/                   # System tray integration and lifecycle
│   ├── vault/                  # VaultService: file/folder tree CRUD, attachments, trash
│   └── watcher/                # fsnotify wrapper with debounce and self-write suppression
├── frontend/
│   ├── src/
│   │   ├── components/         # TitleBar, FileTree, Editor, QuickSwitcher, GlobalSearch, Modals
│   │   ├── hooks/              # useVault, useTheme hooks
│   │   ├── i18n/               # Localization dictionaries (en, vi)
│   │   ├── App.tsx             # Main application layout and modal orchestration
│   │   ├── main.tsx            # React root mount
│   │   └── style.css           # Tailwind CSS imports, typography overrides, dark theme variables
│   └── wailsjs/                # Auto-generated Wails Go bindings (do not edit manually)
├── build/                      # Build assets, application icons, NSIS installers
└── .github/workflows/          # CI, release, and automated testing workflows
```

---

## 4. Key Implementation Rules & Constraints

### 4.1 Backend (Go)
1. **Never block UI cold start**:
   - `App.startup()` must not perform long-running file scans, Git network operations, or full SQLite re-indexing synchronously.
   - Long-running tasks must execute in background goroutines and notify the frontend via Wails runtime events.
2. **Prevent fsnotify self-write loops**:
   - Every file modification performed by the app (auto-save, rename, Git sync pull) must register its path in the suppression registry (`suppressWindow = 2s`) to avoid triggering redundant watcher events.
3. **Hide Windows console windows**:
   - When invoking system commands (such as `git`) via `os/exec.Command`, always apply Windows process creation flags (`CREATE_NO_WINDOW = 0x08000000` and `HideWindow = true`) on Windows to prevent console window flicker.
4. **Zero plaintext credentials**:
   - Personal Access Tokens (PAT) must never be written to disk in plain text or saved in configuration files. Always use `zalando/go-keyring`.
5. **Conflict resolution without conflict markers**:
   - Never inject raw Git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) into note files. On Git pull conflicts, save the conflicting incoming file as `<Name>.conflict.<timestamp>.md`.

### 4.2 Frontend (React & TypeScript)
1. **Auto-save debouncing**:
   - Changes in the Milkdown Crepe editor are saved automatically to disk after a debounced interval (~600ms). There is no manual `Ctrl+S` requirement.
2. **Typography & Styling**:
   - Milkdown Crepe heading fonts must be overridden to Sans-serif (`Nunito, sans-serif`) to maintain visual consistency with the rest of the application.
3. **i18n completeness**:
   - Whenever introducing new user-facing strings, add translation keys to both `en` and `vi` in `frontend/src/i18n/index.ts`.
4. **Wails IPC bindings**:
   - Do not edit files in `frontend/wailsjs/` by hand. These are automatically regenerated by the Wails CLI when backend methods change.

---

## 5. Coding & Documentation Standards

- **Language**:
  - Always write code comments, docstrings, commit messages, and markdown documentation in **English**.
  - User-facing UI text supports both English and Vietnamese through the i18n module.
- **Go Conventions**:
  - Adhere to standard Go idioms (`gofmt`, `go vet`).
  - Guard concurrent state using `sync.RWMutex` or `sync.Mutex` where appropriate.
  - Wrap errors with descriptive context using `fmt.Errorf("...: %w", err)`.
- **TypeScript Conventions**:
  - Enable strict type checks; avoid `any`.
  - Use React 19 functional components and hooks.

---

## 6. Git Commit Convention

All git commit messages must be written in **English** and strictly follow this template:

```
type: commit title

 - commit body line 1
 - commit body line 2
```

Where `type` is one of: `feat`, `fix`, `refactor`, `perf`, `docs`, `style`, `test`, `chore`.

---

## 7. Verification & Build Commands

Before finalizing changes, verify both backend and frontend:

### Backend Verification
```bash
go build ./...
go vet ./...
go test -v ./...
```

### Frontend Verification
```bash
cd frontend
npm run build
```

### Development & Packaging (Wails)
```bash
# Run in development mode with live reload
wails dev

# Build production binary
wails build

# Build Windows installer (requires NSIS)
wails build -nsis
```

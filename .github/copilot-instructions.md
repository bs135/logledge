# Copilot Instructions for Logledge

This repository contains **Logledge**, a desktop, local-first note-taking application based on plain `.md` files synchronized across devices via GitHub.

---

## 1. Project Overview & Philosophy

- **Local-First & Data Sovereignty**: Notes are stored directly as plain `.md` files in a local directory (Vault) on the user's disk. Do not store note content in proprietary formats or internal databases; SQLite is used strictly for secondary indexing (FTS5).
- **Desktop Performance Targets**:
  - Cold-start: `< 1s` (never block startup or UI mount on heavy tasks like sync or re-indexing).
  - Idle RAM: `< 80MB`.
  - Binary size: `< 30MB`.
- **Backward compatibility**: Releases up to 0.5.0 were built with Wails (Go). The Rust backend reads the same `config.json`, search index location and keychain entry, so upgrades keep the user's vaults, settings and PAT. Do not change those paths or formats without a migration.

---

## 2. Technology Stack

### Backend (Rust, Tauri v2)
- **Application Framework**: [Tauri v2](https://tauri.app) with the `dialog`, `opener` and `single-instance` plugins and the built-in tray (`tray-icon` feature).
- **Database / Full-Text Search**: `rusqlite` (bundled SQLite with FTS5).
- **Filesystem Watcher**: `notify` with debounce and self-write suppression.
- **Git Sync Engine**: System `git` CLI via `std::process::Command` (with `CREATE_NO_WINDOW` on Windows).
- **Credential Storage**: OS Keychain / Credential Manager via the `keyring` crate.
- **Trash / Recycle Bin**: `trash`.
- **Fuzzy Matching**: `src-tauri/src/fuzzy.rs`, a port of `sahilm/fuzzy` ranking.

### Frontend (Node.js 24+, React 19, TypeScript)
- **Framework & Bundler**: React 19, TypeScript 5.6+, Vite 7.
- **Styling**: Tailwind CSS v4 (`@tailwindcss/vite`), CSS custom variants for dark mode, custom fonts (`Nunito`).
- **Markdown Editor**: [CodeMirror 6](https://codemirror.net) with custom Obsidian-style Live Preview (inline markdown editing).
- **Icons**: `lucide-react`.
- **Toast Notifications**: `sonner`, mounted once via `AppToaster` (`src/components/AppToaster.tsx`); call `toast(...)` from `sonner` anywhere.
- **Internationalization (i18n)**: English (`en`) and Vietnamese (`vi`) in `src/i18n/index.ts`.

---

## 3. Directory Structure

```
├── src/                        # React frontend
│   ├── components/             # TitleBar, FileTree, Editor, QuickSwitcher, GlobalSearch, Modals
│   ├── hooks/                  # useVault, useTheme hooks
│   ├── i18n/                   # Localization dictionaries (en, vi)
│   ├── lib/                    # api.ts (typed Tauri command wrappers), types.ts, updater.ts
│   ├── App.tsx                 # Main application layout and modal orchestration
│   ├── main.tsx                # React root mount
│   └── style.css               # Tailwind CSS imports, typography overrides, dark theme variables
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── lib.rs              # Tauri builder: plugins, state, command registration
│   │   ├── commands.rs         # Tauri commands exposed to the frontend
│   │   ├── state.rs            # AppState: services plus multi-vault configuration
│   │   ├── config.rs           # config.json (multi-vault, active vault, theme, language, filter)
│   │   ├── vault.rs            # VaultService: file/folder tree CRUD, attachments, trash
│   │   ├── watcher.rs          # notify wrapper with debounce and self-write suppression
│   │   ├── search.rs           # SQLite FTS5 indexer and Global Search
│   │   ├── fuzzy.rs            # Quick Switcher fuzzy matching
│   │   ├── gitsync/            # Git sync engine, git CLI execution, keychain credentials
│   │   ├── tray.rs             # System tray menu
│   │   └── lifecycle.rs        # Hide-to-tray and graceful quit with final sync
│   ├── capabilities/           # Tauri permissions for the main window
│   ├── icons/                  # App icons (source artwork in icons/source/)
│   ├── windows/hooks.nsh       # NSIS installer hooks
│   └── tauri.conf.json         # Tauri app and bundle configuration
├── docs/                       # Project documentation, planning, and guides
│   └── assets/                 # Project documentation assets (images, diagrams, etc.)
└── .github/workflows/          # CI, release, and test build workflows
```

---

## 4. Key Implementation Rules & Constraints

### 4.1 Backend (Rust)
1. **Never block the UI**:
   - Commands are `async` and run file, git and SQLite work through `spawn_blocking`.
   - Setup must not perform long-running file scans, Git network operations, or full re-indexing synchronously. Long-running tasks run on background threads and notify the frontend with events (`vault:changed`, `sync:status`).
2. **Prevent watcher self-write loops**:
   - Every file modification performed by the app (auto-save, rename, Git sync pull) must register its path for suppression (2s window) to avoid redundant watcher events.
3. **Hide Windows console windows**:
   - When invoking system commands (such as `git`), always set the `CREATE_NO_WINDOW` creation flag on Windows to prevent console window flicker.
4. **Zero plaintext credentials**:
   - Personal Access Tokens (PAT) must never be written to disk in plain text, saved in configuration files, or included in error messages. Always use the OS keychain (`gitsync/credentials.rs`).
5. **Conflict resolution without conflict markers**:
   - Never inject raw Git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) into note files. On Git pull conflicts, save the conflicting incoming file as `<Name>.conflict.<timestamp>.md`.
6. **Quitting**:
   - Every quit path must go through `lifecycle::graceful_quit()` so the final sync runs; closing the window only hides it to the tray.

### 4.2 Frontend (React & TypeScript)
1. **Auto-save debouncing**:
   - Changes in the CodeMirror 6 editor are saved automatically to disk after a debounced interval (~600ms). There is no manual `Ctrl+S` requirement.
2. **Typography & Styling**:
   - CodeMirror 6 heading fonts and content use Sans-serif (`Nunito, sans-serif`) to maintain visual consistency with the rest of the application.
3. **i18n completeness**:
   - Whenever introducing new user-facing strings, add translation keys to both `en` and `vi` in `src/i18n/index.ts`.
4. **Backend calls**:
   - Call the backend only through `src/lib/api.ts`. When adding a Tauri command, register it in `src-tauri/src/lib.rs`, add its wrapper to `api.ts` (argument keys are the camelCase form of the Rust parameter names) and any new shapes to `src/lib/types.ts`.
   - Subscribe to backend events with `onEvent()` from `api.ts` and return its unsubscribe from the effect.

---

## 5. Coding & Documentation Standards

- **Language**:
  - Always write code comments, docstrings, commit messages, and markdown documentation in **English**.
  - User-facing UI text supports both English and Vietnamese through the i18n module.
- **Rust Conventions**:
  - Code must pass `cargo fmt` and `cargo clippy --all-targets -- -D warnings`.
  - Guard shared state with `Mutex` / `RwLock` inside `Arc` where appropriate.
  - Return `error::Result` from commands; add context to errors so the UI receives a readable message.
- **TypeScript Conventions**:
  - Enable strict type checks; avoid `any`.
  - Use React 19 functional components and hooks.

---

## 6. Git Commit Convention

All git commit messages must be written in **English** and strictly follow this template:

```
type(scope): commit title

 - commit body line 1
 - commit body line 2
```

Where `type` is one of: `feat`, `fix`, `refactor`, `perf`, `docs`, `style`, `test`, `chore`. `scope` should be a concise description of the area of the codebase affected by the commit (e.g., `backend`, `frontend`, `api`).

---

## 7. Verification & Build Commands

Before finalizing changes, verify both backend and frontend:

### Backend Verification (from `src-tauri/`)
```bash
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

### Frontend Verification
```bash
npm run build
npm test
```

### Development & Packaging (Tauri)
```bash
# Run in development mode with live reload
npm run tauri dev

# Build production bundles (NSIS installer on Windows)
npm run tauri build
```

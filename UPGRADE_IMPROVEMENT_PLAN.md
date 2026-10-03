# Logledge Upgrade & Improvement Plan

## 1. Problem Statement & Feasibility Assessment

The Logledge application is a desktop Markdown note-taking app built with **Wails v2 (Go backend) + React 19 / TypeScript / Vite / Tailwind CSS / Milkdown Crepe**.

The proposed 4-sprint roadmap addresses critical UX flaws, modernizes the app shell, adds essential productivity features (multi-vault, settings, i18n), and integrates native desktop conveniences (system tray, frameless title bar).

### Feasibility & Realistic Adjustments:
1. **Hide Git Sync Console (Sprint 1)**: Highly feasible. On Windows, `os/exec.Command` spawns visible console windows unless `SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}` is set. We will isolate this into OS-specific execution helpers (`gitsync_windows.go` / `gitsync_other.go`).
2. **Auto-refresh Editor After Sync (Sprint 1)**: Highly feasible. When Git pull updates files or `vault:changed` triggers, if the active note was modified on disk and has no unsaved changes, reload seamlessly. If the user has unsaved edits, alert them via a non-intrusive prompt ("File updated on disk. Reload / Keep draft").
3. **Left-side Context Menu Positioning (Sprint 1)**: Highly feasible. `FileTree.tsx` currently hardcodes `left: 1rem` without capturing pointer coordinates (`e.clientX`, `e.clientY`). We will pass event coordinates and constrain them within viewport boundaries.
4. **Fixed WebView2 User Data Path (Sprint 1)**: Highly feasible. Wails `options/windows.Options` provides `WebviewUserDataPath`. We will set it to `%APPDATA%\Logledge\webview2` so renaming binaries or updating versions does not generate orphan cache folders.
5. **Sans-serif Headers (Sprint 1)**: Highly feasible. Milkdown Crepe sets `--crepe-font-title: 'Noto Serif', ...`. Overriding this variable to `var(--crepe-font-default)` or `Nunito, sans-serif` in CSS immediately unifies typography.
6. **Custom Frameless Title Bar (Sprint 2)**: Highly feasible. Enable `Frameless: true` in Wails, preserve native window snapping and shadows with `DisableFramelessWindowDecorations: false`, and render a custom React TitleBar with `--wails-draggable: drag` and window control buttons (Minimize, Maximize/Restore, Close).
7. **Toggle Left Sidebar (Sprint 2)**: Highly feasible. Add collapsible state with `Ctrl+B` shortcut, toggle button in TitleBar, and persist state in `localStorage`.
8. **Inline Title / Auto-rename (Sprint 2)**: Highly feasible with practical adjustment. Instead of renaming on every keystroke inside the editor's `# H1` tag (which risks invalid filename errors and search reindexing thrashing while typing), provide a dedicated Notion/Obsidian-style top Title Input field that synchronizes with the note filename on blur/enter with sanitized characters.
9. **File Filter (Sprint 2)**: Highly feasible. Filter file tree to display Markdown notes (`.md`, `.markdown`, `.txt`) by default, with an option to toggle "Show all files". Ensure internal directories (`.git`, `.attachments`) remain hidden.
10. **Editor Context Menu (Sprint 2)**: Highly feasible. Right-click context menu with Cut, Copy, Paste, and markdown formatting actions.
11. **Settings Dialog & Dark/Light Theme (Sprint 3)**: Highly feasible. Create a unified tabbed Settings modal (General, Appearance, Sync, About). Dark/Light mode will toggle theme classes, Crepe editor CSS variables, and Wails `WindowSetDarkTheme` / `WindowSetLightTheme`.
12. **Multi-Vault Support (Sprint 3)**: Highly feasible. Extend `config.Config` to store a list of known vaults (`Vaults []VaultInfo`) and active vault. Add backend methods `GetVaults`, `SwitchVault`, `AddVault`, `RemoveVault`, and a vault switcher UI in the title bar / sidebar header.
13. **i18n (Tiếng Việt / English) (Sprint 3)**: Highly feasible. Add lightweight dictionary-based translation (`useI18n`) with language switcher.
14. **Quick Help & About Dialog (Sprint 4)**: Highly feasible. Help modal showing version, keyboard shortcuts reference, markdown cheat sheet, and project links.
15. **System Tray Integration (Sprint 4)**: Highly feasible. Integrate `github.com/getlantern/systray` (pure Go Windows API, CGO_ENABLED=0 compatible) with menu items (Open Logledge, Sync Now, Quit) and `HideWindowOnClose: true` option.

---

## 2. Sprint Breakdown & Execution Steps

### Sprint 1: Clean & Fix
- **Task 1.1**: Add Windows-specific `SysProcAttr` with `HideWindow: true` and `CREATE_NO_WINDOW` flag for Git commands.
- **Task 1.2**: Update active note content in `App.tsx` and `Editor.tsx` when disk content changes or sync completes.
- **Task 1.3**: Fix context menu coordinate calculation in `FileTree.tsx`.
- **Task 1.4**: Configure `WebviewUserDataPath` in `main.go` under `windows.Options`.
- **Task 1.5**: Override `--crepe-font-title` in `style.css` to use Sans-serif font (`Nunito, sans-serif`).

### Sprint 2: Shell & UI Polish
- **Task 2.1**: Implement custom frameless title bar with drag region, window title, vault name, and min/max/close controls.
- **Task 2.2**: Implement Left Sidebar collapse/expand with toggle button and `Ctrl+B` shortcut.
- **Task 2.3**: Build inline note title input in Editor with auto-rename and character sanitization on blur/Enter.
- **Task 2.4**: Implement file filter for `.md`/notes on tree view with toggle support.
- **Task 2.5**: Build custom right-click context menu for the Editor area.

### Sprint 3: App Settings & Multi-Vault
- **Task 3.1**: Build unified tabbed Settings Dialog (General, Appearance, Git Sync, About).
- **Task 3.2**: Implement Dark / Light / System theme toggle across App shell and Crepe editor.
- **Task 3.3**: Implement backend multi-vault management (`config.Config`, `SwitchVault`, `GetVaults`) and frontend vault switcher.
- **Task 3.4**: Implement i18n support for English and Vietnamese.

### Sprint 4: OS Extras & Quick Help
- **Task 4.1**: Build About & Quick Help dialog with Markdown syntax and shortcut cheat sheets.
- **Task 4.2**: Integrate system tray icon with quick actions (Show, Sync Now, Quit) and hide-to-tray behavior.

---

## 3. Verification & Validation Strategy
- **Go Tests**: Run `go test ./...` across all packages to ensure zero regressions.
- **Frontend Build & Types**: Run `npm run build` (`tsc && vite build`) to ensure strict TypeScript compliance.
- **End-to-End Validation**: Verify window controls, file synchronization, context menus, and theme switching in the desktop build.


## 1. Problem Statement & Feasibility Assessment

The Logledge application is a desktop Markdown note-taking app built with **Wails v2 (Go backend) + React 19 / TypeScript / Vite / Tailwind CSS / Milkdown Crepe**.

The proposed 4-sprint roadmap addresses critical UX flaws, modernizes the app shell, adds essential productivity features (multi-vault, settings, i18n), and integrates native desktop conveniences (system tray, frameless title bar).

### Feasibility & Realistic Adjustments:
1. **Hide Git Sync Console (Sprint 1)**: Highly feasible. On Windows, `os/exec.Command` spawns visible console windows unless `SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}` is set. We will isolate this into OS-specific execution helpers (`gitsync_windows.go` / `gitsync_other.go`).
2. **Auto-refresh Editor After Sync (Sprint 1)**: Highly feasible. When Git pull updates files or `vault:changed` triggers, if the active note was modified on disk and has no unsaved changes, reload seamlessly. If the user has unsaved edits, alert them via a non-intrusive prompt ("File updated on disk. Reload / Keep draft").
3. **Left-side Context Menu Positioning (Sprint 1)**: Highly feasible. `FileTree.tsx` currently hardcodes `left: 1rem` without capturing pointer coordinates (`e.clientX`, `e.clientY`). We will pass event coordinates and constrain them within viewport boundaries.
4. **Fixed WebView2 User Data Path (Sprint 1)**: Highly feasible. Wails `options/windows.Options` provides `WebviewUserDataPath`. We will set it to `%APPDATA%\Logledge\webview2` so renaming binaries or updating versions does not generate orphan cache folders.
5. **Sans-serif Headers (Sprint 1)**: Highly feasible. Milkdown Crepe sets `--crepe-font-title: 'Noto Serif', ...`. Overriding this variable to `var(--crepe-font-default)` or `Nunito, sans-serif` in CSS immediately unifies typography.
6. **Custom Frameless Title Bar (Sprint 2)**: Highly feasible. Enable `Frameless: true` in Wails, preserve native window snapping and shadows with `DisableFramelessWindowDecorations: false`, and render a custom React TitleBar with `--wails-draggable: drag` and window control buttons (Minimize, Maximize/Restore, Close).
7. **Toggle Left Sidebar (Sprint 2)**: Highly feasible. Add collapsible state with `Ctrl+B` shortcut, toggle button in TitleBar, and persist state in `localStorage`.
8. **Inline Title / Auto-rename (Sprint 2)**: Highly feasible with practical adjustment. Instead of renaming on every keystroke inside the editor's `# H1` tag (which risks invalid filename errors and search reindexing thrashing while typing), provide a dedicated Notion/Obsidian-style top Title Input field that synchronizes with the note filename on blur/enter with sanitized characters.
9. **File Filter (Sprint 2)**: Highly feasible. Filter file tree to display Markdown notes (`.md`, `.markdown`, `.txt`) by default, with an option to toggle "Show all files". Ensure internal directories (`.git`, `.attachments`) remain hidden.
10. **Editor Context Menu (Sprint 2)**: Highly feasible. Right-click context menu with Cut, Copy, Paste, and markdown formatting actions.
11. **Settings Dialog & Dark/Light Theme (Sprint 3)**: Highly feasible. Create a unified tabbed Settings modal (General, Appearance, Sync, About). Dark/Light mode will toggle theme classes, Crepe editor CSS variables, and Wails `WindowSetDarkTheme` / `WindowSetLightTheme`.
12. **Multi-Vault Support (Sprint 3)**: Highly feasible. Extend `config.Config` to store a list of known vaults (`Vaults []VaultInfo`) and active vault. Add backend methods `GetVaults`, `SwitchVault`, `AddVault`, `RemoveVault`, and a vault switcher UI in the title bar / sidebar header.
13. **i18n (Tiếng Việt / English) (Sprint 3)**: Highly feasible. Add lightweight dictionary-based translation (`useI18n`) with language switcher.
14. **Quick Help & About Dialog (Sprint 4)**: Highly feasible. Help modal showing version, keyboard shortcuts reference, markdown cheat sheet, and project links.
15. **System Tray Integration (Sprint 4)**: Highly feasible. Integrate `github.com/getlantern/systray` (pure Go Windows API, CGO_ENABLED=0 compatible) with menu items (Open Logledge, Sync Now, Quit) and `HideWindowOnClose: true` option.

---

## 2. Sprint Breakdown & Execution Steps

### Sprint 1: Clean & Fix
- **Task 1.1**: Add Windows-specific `SysProcAttr` with `HideWindow: true` and `CREATE_NO_WINDOW` flag for Git commands.
- **Task 1.2**: Update active note content in `App.tsx` and `Editor.tsx` when disk content changes or sync completes.
- **Task 1.3**: Fix context menu coordinate calculation in `FileTree.tsx`.
- **Task 1.4**: Configure `WebviewUserDataPath` in `main.go` under `windows.Options`.
- **Task 1.5**: Override `--crepe-font-title` in `style.css` to use Sans-serif font (`Nunito, sans-serif`).

### Sprint 2: Shell & UI Polish
- **Task 2.1**: Implement custom frameless title bar with drag region, window title, vault name, and min/max/close controls.
- **Task 2.2**: Implement Left Sidebar collapse/expand with toggle button and `Ctrl+B` shortcut.
- **Task 2.3**: Build inline note title input in Editor with auto-rename and character sanitization on blur/Enter.
- **Task 2.4**: Implement file filter for `.md`/notes on tree view with toggle support.
- **Task 2.5**: Build custom right-click context menu for the Editor area.

### Sprint 3: App Settings & Multi-Vault
- **Task 3.1**: Build unified tabbed Settings Dialog (General, Appearance, Git Sync, About).
- **Task 3.2**: Implement Dark / Light / System theme toggle across App shell and Crepe editor.
- **Task 3.3**: Implement backend multi-vault management (`config.Config`, `SwitchVault`, `GetVaults`) and frontend vault switcher.
- **Task 3.4**: Implement i18n support for English and Vietnamese.

### Sprint 4: OS Extras & Quick Help
- **Task 4.1**: Build About & Quick Help dialog with Markdown syntax and shortcut cheat sheets.
- **Task 4.2**: Integrate system tray icon with quick actions (Show, Sync Now, Quit) and hide-to-tray behavior.

---

## 3. Verification & Validation Strategy
- **Go Tests**: Run `go test ./...` across all packages to ensure zero regressions.
- **Frontend Build & Types**: Run `npm run build` (`tsc && vite build`) to ensure strict TypeScript compliance.
- **End-to-End Validation**: Verify window controls, file synchronization, context menus, and theme switching in the desktop build.

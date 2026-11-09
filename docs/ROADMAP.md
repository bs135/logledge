# Logledge — UI/UX & Feature Roadmap

Living document. Each item is updated as soon as it lands, so this file always matches
what is actually in the code.

**Status legend:** ⬜ Planned · 🚧 In progress · ✅ Done · ⏸ Deferred

## How the order was chosen

Items are ordered so that each one builds on infrastructure from earlier items and no
item needs a big refactor of something already shipped:

1. **Linking & navigation first.** Resolving a note name to a path (1.1) is reused by
   autocomplete (1.2), backlinks (3.2), daily notes (4.2) and the graph view (6.3).
   Navigation history (1.3) and recent notes (1.4) are needed once links make jumping
   between notes common.
2. **Small, independent polish next.** Phase 2 items touch one component each, carry
   little risk and can ship in any order.
3. **The right-hand panel before the features that live in it.** Outline (3.1) adds the
   panel with a pure-frontend feature; backlinks (3.2) and tags (3.3) then extend the
   Rust search index with a links/tags table.
4. **Command palette after most commands exist** (4.1), so it ships with a useful list.
5. **Git-powered features together** (Phase 5): both need a diff view and new git
   commands in `gitsync`.
6. **Large or risky features last** (Phase 6). Tabs change how `App.tsx` holds the open
   note, so they come after everything that reads `selectedPath`.

## Workflow per item

- One branch per item, `feat/<short-name>`, created from `develop` (or from the previous
  item's branch while that one is not merged yet).
- Implement, add/extend `node --test` unit tests for pure logic, run `npm test` and
  `npm run build` (plus `cargo test` for Rust changes).
- **Manual test by the maintainer before every commit.**
- Commit, then update this file (status, notes on what was actually built) and the
  README feature list.

---

## Phase 1 — Linking & navigation

| # | Item | Status | Branch |
|---|------|--------|--------|
| 1.1 | WikiLink navigation | ✅ | `feat/wikilink-navigation` |
| 1.2 | `[[` autocomplete | ✅ | `feat/wikilink-autocomplete` |
| 1.3 | Back / Forward history | ⬜ | |
| 1.4 | Recent & pinned notes | ⬜ | |

### 1.1 WikiLink navigation
- `Ctrl/Cmd+Click` on `[[Note]]` opens the note (same gesture as external links).
- Supports `[[Note|Alias]]` (shows the alias), `[[Note#Heading]]` (scrolls to the
  heading), `[[folder/Note]]` (path from the vault root) and `[[#Heading]]` (same note).
- Resolution (`src/lib/wikilink.ts`): exact relative path first, otherwise basename match
  (case-insensitive), preferring the current note's folder, then the shortest path.
- Links to missing notes look different: dimmed, no background, wavy underline, and
  the tooltip says the note does not exist.
- Clicking a link to a missing note asks first ("Create a new note?" with the path that
  will be created), so a typo does not silently create a stray note. On confirm the
  note is created (in the current note's folder, or at the given path) and opened.
- Works inside rendered tables too.
- **As built:** resolver and heading lookup in `src/lib/wikilink.ts` (unit tests in
  `test-wikilink.mjs`); `livePreview.ts` hides `Target|` for aliased links and puts the
  raw link text in `data-wiki-target`; `Editor.tsx` handles Ctrl/Cmd+Click on
  `mousedown` in the capture phase (a `click` handler misses it: CodeMirror moves the
  cursor into the link on mousedown and Live Preview replaces the clicked element),
  for both WikiLinks and external links, plus the `scrollTarget` and `notePaths` props.
  Missing-link styling: `notePathsField` (a StateField, updated with the `setNotePaths`
  effect whenever the file tree changes) feeds `resolveWikiLink` in `buildDecorations`;
  table cells carry a `missing` flag in the widget data. `App.tsx#handleOpenWikiLink`
  resolves against the file tree; a miss opens a `ConfirmModal`, and
  `handleConfirmNoteCreate` creates missing parent folders and the note. `useVault` now
  exposes `refresh`.
- Pulled forward from 3.2: styling unresolved links (3.2 still adds the backlink index).
- Not done here: heading completion (1.2); a link to an existing note whose heading is
  missing just opens the note at the top.

### 1.2 `[[` autocomplete
- Typing `[[` opens a completion list of notes (fuzzy match), notes in the current
  folder ranked first among equal matches; the current note is left out.
- Accepting inserts the shortest name that still resolves to that note (`Roadmap`, or
  `old/Roadmap` when names clash) plus `]]`, unless `]]` already follows the cursor.
- `[[Note#` lists that note's headings in document order; `[[#` lists the current
  note's headings. Nothing is suggested after `|` (alias).
- Headings are linked by their visible text (`headingLinkText`): a heading such as
  `# See [[README.md]]` is suggested and inserted as `[[#See README.md]]`, since `[[`,
  `]]`, `|` and `#` would break the link. Heading lookup on Ctrl+Click compares both
  sides in this form, so the raw heading text still matches too.
- **As built:** pure helpers in `src/lib/wikilink.ts` (`wikiCompletionContext`,
  `noteCompletionEntries`, `extractHeadings`); the CodeMirror source in
  `src/components/wikiComplete.ts` reads notes from `notePathsField` (from 1.1) instead
  of calling the Rust `quick_switch`, and reads the target note with `readFile` only for
  heading completion. `Editor.tsx` adds `autocompletion({override: [...]})`, so
  lang-markdown's HTML tag completion stays off. `@codemirror/autocomplete` is now a
  direct dependency. Dropdown styled for light/dark in `style.css`. Tests:
  `test-wikilink.mjs` and `test-wiki-complete.mjs` (runs the real source).

### 1.3 Back / Forward history
- Per-session stack of opened notes in `App.tsx`; `Alt+←` / `Alt+→` and mouse
  buttons 4/5; back/forward buttons in the title bar.
- Renames, moves and deletes update or drop entries.

### 1.4 Recent & pinned notes
- Quick Switcher with an empty query lists pinned notes, then recent notes.
- Pin/unpin from the file-tree context menu; stored per vault in the config.

## Phase 2 — Editor & file-tree polish

| # | Item | Status | Branch |
|---|------|--------|--------|
| 2.1 | Editor status bar | ⬜ | |
| 2.2 | Typography settings & zoom | ⬜ | |
| 2.3 | Paste URL over selection | ⬜ | |
| 2.4 | Empty state | ⬜ | |
| 2.5 | File-tree sort | ⬜ | |

- **2.1** Word/character count (selection-aware), reading time, and save state
  ("Saving…", "Saved", "Not saved — conflict") in the existing status bar.
- **2.2** Settings → Appearance: editor font size, readable line width toggle/width,
  font family. `Ctrl+=` / `Ctrl+-` / `Ctrl+0` zoom.
- **2.3** Pasting a URL while text is selected produces `[text](url)`.
- **2.4** When no note is open: buttons for New note, Daily note (after 4.2), Quick
  Switcher, plus a short list of recent notes and key shortcuts.
- **2.5** Sort by name / modified / created, ascending or descending, folders first
  toggle. Needs `mtime`/`ctime` on `VaultNode` from `vault.rs`.

## Phase 3 — Right panel & knowledge features

| # | Item | Status | Branch |
|---|------|--------|--------|
| 3.1 | Right panel + Outline | ⬜ | |
| 3.2 | Backlinks & unresolved links | ⬜ | |
| 3.3 | Tags | ⬜ | |
| 3.4 | Advanced search & replace | ⬜ | |

- **3.1** Collapsible, resizable right panel (`Ctrl+Shift+\``) with tabs. First tab:
  outline from the CodeMirror syntax tree; click scrolls to the heading, current
  heading highlighted.
- **3.2** Rust: a `links(src, target)` table in the SQLite index, filled during
  incremental indexing. Panel tab lists linked mentions with context snippet, plus
  unlinked mentions (FTS on the note title). (Dimming unresolved `[[links]]` already
  shipped in 1.1.)
- **3.3** `#tag` / `#nested/tag` highlighted in the editor, indexed in a `tags` table,
  tag list in the panel, `tag:foo` filter in Global Search, YAML `tags:` front matter.
- **3.4** Global Search: filter by folder, case-sensitive and regex modes, replace in
  one note or across the vault (preview + confirm, writes go through the normal save
  path so sync and the watcher see them).

## Phase 4 — Workflow

| # | Item | Status | Branch |
|---|------|--------|--------|
| 4.1 | Command palette | ⬜ | |
| 4.2 | Daily notes & templates | ⬜ | |
| 4.3 | Focus mode | ⬜ | |
| 4.4 | Math (KaTeX) | ⬜ | |

- **4.1** `Ctrl+Shift+P`: a command registry (id, label en/vi, shortcut, run) used by
  the palette and Quick Help, so shortcuts are listed in one place.
- **4.2** Settings: daily-note folder, date format, template file. `Ctrl+Alt+D` opens or
  creates today's note. "Insert template" command with `{{date}}`, `{{time}}`,
  `{{title}}` variables; templates folder is hidden from search results.
- **4.3** `F11`/command: hides sidebar, title bar chrome and status bar, centres the
  text column; `Esc` exits.
- **4.4** Render `$inline$` and `$$block$$` with KaTeX widgets (lazy-loaded to keep cold
  start fast). The README already claims this feature — fix the claim until it lands.

## Phase 5 — Git-powered features

| # | Item | Status | Branch |
|---|------|--------|--------|
| 5.1 | Conflict resolution UI | ⬜ | |
| 5.2 | Note version history | ⬜ | |

- **5.1** Status bar shows the number of `*.conflict.*.md` files; a modal lists them with
  a side-by-side diff and *Keep mine* / *Keep theirs* / *Open both* actions. Resolving
  deletes the conflict copy (to trash).
- **5.2** "Version history" for the open note: `git log --follow` list, diff against
  current, restore a version (written as a normal edit, so it syncs).

## Phase 6 — Larger features

| # | Item | Status | Branch |
|---|------|--------|--------|
| 6.1 | Tabs | ⬜ | |
| 6.2 | Export HTML / PDF | ⬜ | |
| 6.3 | Graph view | ⬜ | |
| 6.4 | Note encryption | ⬜ | |
| 6.5 | Mobile | ⬜ | |

- **6.1** Tabs with per-tab history (replaces the single history from 1.3), middle-click
  close, `Ctrl+Tab`, restore open tabs on start.
- **6.2** Export the note as standalone HTML (inlined images and CSS) and print to PDF
  through the webview.
- **6.3** Graph of notes and links from the links table (3.2); local graph for the open
  note in the right panel.
- **6.4** Design spike first: per-folder encryption with a passphrase in the OS keychain,
  encrypted files stay text so git sync works; search index skips encrypted notes.
- **6.5** Research spike only: Tauri v2 mobile targets, git on mobile, read-only first.

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
| 1.3 | Back / Forward history | ✅ | `feat/nav-history` |
| 1.4 | Recent & pinned notes | ✅ | `feat/recent-pinned` |

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
- Per-session history of opened notes (max 100); re-opening the current note adds
  nothing; opening a note after going back drops the forward entries (browser-style).
- `Alt+←` / `Alt+→` on Windows/Linux, `⌘⌥←` / `⌘⌥→` on macOS, mouse back/forward
  buttons, and ←/→ buttons in the title bar (disabled when there is nowhere to go).
- Renames and moves (inline rename, title rename, Cut+Paste, drag-and-drop) update
  entries, folders included; deletes drop them. Entries whose note vanished outside the
  app (sync, file manager) are dropped when navigating. Switching vault clears it.
- After deleting the open note, Back reopens the note you were on before it.
- **As built:** pure, immutable `src/lib/navHistory.ts` (tests: `test-nav-history.mjs`);
  `App.tsx` keeps it in state plus a ref (`navigate`, `handleEntryMoved`). Keys are
  caught on `window` in the capture phase, ahead of CodeMirror's `Alt+←/→`
  (`cursorSyntaxLeft/Right`, which is therefore no longer reachable on Windows/Linux).
  `⌘[`/`⌘]` were avoided because CodeMirror uses them for indent.
- Side fix: drag-and-drop in the file tree now uses `moveTo` like Cut+Paste, so a moved
  open note keeps its new path and move errors are shown (before, `vault.move`
  swallowed errors and the open note kept its old path).
- Not done: restoring the scroll/cursor position when going back (candidate for 6.1
  Tabs).

### 1.4 Recent & pinned notes
- Quick Switcher (`Ctrl+P`) with an empty query lists, under section headers: pinned
  notes (pin order), the 10 most recent notes (not pinned, not the open note), then all
  other notes. While typing, pinned notes keep their pin icon among the matches.
- Pin / Unpin from the file-tree context menu (notes only); pinned notes show a small
  pin icon in the tree.
- Renames, moves and deletes update both lists; notes deleted outside the app are
  hidden. Every opened note counts as recent, including via Back/Forward.
- On startup and after switching vaults, the vault's last viewed note is reopened (the
  most recent one that still exists), once its file tree has loaded.
- **As built:** pure `src/lib/noteLists.ts` (tests: `test-note-lists.mjs`); stored per
  vault in `localStorage` by `src/hooks/useNoteLists.ts` (key
  `logledge:noteLists:<vault path>`) instead of the Rust config planned above: no
  backend change needed, same approach as the sidebar width. Up to 30 recent notes are
  remembered. `FileTree` gets pins through a React context rather than threading props
  through every `TreeEntry`.

## Phase 2 — Editor & file-tree polish

| # | Item | Status | Branch |
|---|------|--------|--------|
| 2.1 | Editor status bar | ✅ | `feat/editor-status-bar` |
| 2.2 | Typography settings & zoom | ✅ | `feat/typography-zoom` |
| 2.3 | Paste URL over selection | ✅ | `feat/paste-url-link` |
| 2.4 | Empty state | ✅ | `feat/empty-state` |
| 2.5 | File-tree sort | ✅ | `feat/tree-sort` |

- **2.1** Word/character count (selection-aware), reading time, and save state
  ("Saving…", "Saved", "Not saved — conflict") in the existing status bar.
  - **As built:** right side of the bottom bar while a note is open: save state
    (Saved / Unsaved / Saving… / Not saved — file changed on disk / Save failed, with
    the error as tooltip), then words, characters and reading time (200 wpm). With a
    selection: `selected / total`. Words are letter/digit runs (so Markdown markers and
    link URLs don't count; Vietnamese works); characters exclude line breaks. Counts
    and reading time hide progressively on narrow windows.
  - Code: pure `src/lib/textStats.ts` (tests: `test-text-stats.mjs`);
    `Editor.tsx#onStatsChange` (debounced 150 ms); save state set from `queueSave` and
    `onContentChange` in `App.tsx`; `src/components/EditorStatus.tsx` rendered through a
    new `children` slot of `SyncStatusBar`.
  - Side fix found while testing: when the open note's file is deleted or moved outside
    the app, the editor used to keep showing it as "Saved", and the next auto-save
    silently recreated the file. Now a banner says so, offering **Restore** (write the
    editor content back) or **Close**; the status shows "Deleted on disk — not saving"
    and auto-save is paused until Restore. If the file comes back (trash restore, sync)
    the banner clears by itself. A move/rename outside the app counts as a delete,
    since the app cannot tell where the file went.
- **2.2** Settings → Appearance: editor font size, readable line width toggle/width,
  font family. `Ctrl+=` / `Ctrl+-` / `Ctrl+0` zoom.
  - **As built:** Settings → Appearance → "Editor text": font size slider (12–28 px,
    default 16), font (Sans/Nunito, Serif, Mono, System), readable line width toggle +
    slider (480–1400 px, 760 when turned on; off by default = full width, as before),
    and Reset. `Ctrl+=`/`Ctrl+-` change the size by 1 px, `Ctrl+0` resets it; a toast
    shows the zoom level. Settings are app-wide, stored in `localStorage`.
  - Code: pure `src/lib/typography.ts` (tests: `test-typography.mjs`);
    `src/hooks/useTypography.ts` sets `--editor-font-size`, `--editor-font-family` and
    `--editor-line-width` on `<html>`, read by `style.css` and the note title. To make
    everything scale, heading sizes/padding in `style.css` and the Tailwind `text-xs`,
    `text-sm`, `text-[10px]` classes in `livePreview.ts` moved from rem/px to em (so
    Markdown markers revealed inside a heading are now sized relative to the heading).
- **2.3** Pasting a URL while text is selected produces `[text](url)`.
  - **As built:** applies when the clipboard holds exactly one `http(s)://` or
    `mailto:` URL and every selection range is non-empty, single-line, not itself a
    URL and not inside inline code / a code block; otherwise the normal paste runs.
    Works with multiple cursors. `[`, `]` and `\` in the text are escaped; a URL with
    parentheses is written as `<url>`. One transaction, so one `Ctrl+Z` restores the
    text. Code: `src/components/pasteLink.ts` (tests: `test-paste-link.mjs`).
  - Side fix found while testing: Live Preview showed backslash escapes (`\[`, `\*`)
    literally in view mode everywhere outside tables. The backslash is now hidden like
    other markup and revealed (dimmed) when the cursor is on it, or anywhere in the
    link/emphasis that contains it (`livePreview.ts`, `Escape` nodes).
- **2.4** When no note is open: buttons for New note, Daily note (after 4.2), Quick
  Switcher, plus a short list of recent notes and key shortcuts.
  - **As built:** `src/components/EmptyState.tsx` replaces the "Select a note…"
    placeholder: New note (in the active tree folder), Open a note… (`Ctrl+P`), Search
    in vault… (`Ctrl+Shift+F`), up to 8 pinned then recent notes (via
    `switcherSections`, so deleted notes are hidden), four key shortcuts and a link to
    Quick Help. A vault with no Markdown notes gets "create your first note" with New
    note as the primary button. The Daily note button is added with 4.2.
- **2.5** Sort by name / modified / created, ascending or descending, folders first
  toggle. Needs `mtime`/`ctime` on `VaultNode` from `vault.rs`.
  - **As built:** a sort button in the explorer header (highlighted when not the
    default) opens: File name A→Z / Z→A, Modified new→old / old→new, Created
    new→old / old→new, and a "Folders first" toggle. Default = previous order (folders
    first, A→Z). Names sort naturally ("note 2" before "note 10"). A folder's modified
    time is its most recently modified file (any depth), so the folders you were
    working in come first; entries without a time go last. App-wide, in
    `localStorage`.
  - Code: Rust `Node` gained optional `modified` / `created` (ms since epoch; created
    is absent where the OS/file system has none) in `vault.rs`, test
    `tree_reports_modification_times`. Frontend: pure `src/lib/treeSort.ts` (tests:
    `test-tree-sort.mjs`), `TreeSortMenu.tsx`, applied in `FileTree` (whose filter
    now keeps all node fields).
  - Later refined: the separate file-filter toggle and the sort button were merged
    into one **View options** button (sliders icon, `ExplorerViewMenu.tsx`, formerly
    `TreeSortMenu.tsx`): sort options, "Folders first", "Apply file filter" (with the
    extensions it shows/hides) and "Edit file filter…" (opens Settings › Filter). It is
    highlighted when the sort is not the default or the filter is off. The explorer
    header now holds View options plus the two actions (new note, new folder).
    The menu is `position: fixed`, placed from the button and kept inside the window
    (the old sort menu was `absolute` and got cut off by the sidebar's
    `overflow: hidden` when the sidebar was narrow).
  - Checks: `cargo fmt --check` and `cargo clippy --all-targets -- -D warnings` clean;
    `cargo test` 70/71 — the one failure,
    `state::tests::final_sync_runs_once_and_respects_timeout`, also fails on clean
    `develop` (passes when run alone), so it is pre-existing and tracked separately.

## Phase 3 — Right panel & knowledge features

| # | Item | Status | Branch |
|---|------|--------|--------|
| 3.1 | Right panel + Outline | ✅ | `feat/right-panel-outline` |
| 3.2 | Backlinks & unresolved links | ✅ | `feat/backlinks` |
| 3.3 | Tags | ✅ | `feat/tags` |
| 3.4 | Advanced search & replace | ✅ | `feat/advanced-search` |

- **3.1** Collapsible, resizable right panel (`Ctrl+Shift+\``) with tabs. First tab:
  outline from the CodeMirror syntax tree; click scrolls to the heading, current
  heading highlighted.
  - **As built:** toggled by `Ctrl+Shift+\` (`⌘⇧\` on macOS; caught in the capture
    phase ahead of CodeMirror's `cursorMatchingBracket`, which no longer has a key),
    a title-bar button or the panel's ×. Drag its left edge to resize (180–560 px),
    double-click to reset to 260; open state and width are remembered. Tab bar with
    one tab for now (Outline), ready for Backlinks (3.2) and Tags (3.3).
  - Outline: ATX and setext headings from the syntax tree (headings in code are not
    included), indented relative to the shallowest level, inline Markdown removed from
    the text. Click scrolls to the heading and puts the cursor there. The highlighted
    heading is the section holding the cursor while the cursor's line is on screen
    (so a clicked heading near the end of the note, which can't scroll to the top, is
    still the one highlighted, as is the section being edited); otherwise it is the
    section at the top of the visible area. It is kept in view while scrolling.
  - A first row "Top of note" (arrow-to-top icon, fixed label) jumps to the top of the note;
    it is highlighted while reading the part before the first heading, and is shown
    even when the note has no headings.
  - ⏸ Deferred: collapse / expand of outline branches (all expanded by default,
    auto-expand the branch of the highlighted heading, collapse-all button, state kept
    per note for the session). Not needed for typical notes; revisit if outlines get
    long.
  - Code: pure `src/lib/outline.ts` and `src/components/outlineExtract.ts` (tests:
    `test-outline.mjs`); `RightPanel.tsx`; `Editor.tsx` reports `onOutlineChange`
    (debounced 200 ms, also when the background parser fills in the tree) and
    `onReadingPosChange` (once per frame while scrolling); `scrollTarget` now also
    takes a document `pos`. `App.tsx` stores only the active heading index, so
    scrolling re-renders the app only when the highlight moves.
- **3.2** Rust: a `links(src, target)` table in the SQLite index, filled during
  incremental indexing. Panel tab lists linked mentions with context snippet, plus
  unlinked mentions (FTS on the note title). (Dimming unresolved `[[links]]` already
  shipped in 1.1.)
  - **As built:** right panel tab **Backlinks**: "Linked mentions" groups the notes
    that link to the open note (wiki links and Markdown links to `.md` files), with
    the linking lines; click a note to open it, a line to open it at that line.
    "Unlinked mentions" (collapsed, loaded on demand) lists notes containing the
    note's title as a phrase without linking to it. Refreshes when the index changes.
  - Rust: `src-tauri/src/links.rs` extracts links outside code (fences, inline code),
    with tests. `search.rs` gained a `links` table (target as written + lookup key =
    file name, lower-case, no extension), filled while indexing; `backlinks(path)`
    returns candidates by key and the frontend resolves each with the same rules as
    Ctrl+Click (`src/lib/backlinks.ts`, tests: `test-backlinks.mjs`), so
    `[[Note]]` from another folder that resolves to a different "Note" is not
    counted. `mentions(phrase)` is an FTS5 phrase query on the body. `PRAGMA
    user_version` 1 rebuilds older indexes once.
  - Side fix: the app's own saves, creates, renames, moves, deletes and copies are
    hidden from the file watcher, so the index (and Global Search) never saw them
    until the next external change or restart. Saves/creates now re-index the note
    right away (`reindex_file`); other file operations start a background reindex.
    A `search:indexed` event is emitted after every index update.
- **3.3** `#tag` / `#nested/tag` highlighted in the editor, indexed in a `tags` table,
  tag list in the panel, `tag:foo` filter in Global Search, YAML `tags:` front matter.
  - **As built:** tag rules (shared by the indexer `src-tauri/src/tags.rs` and the
    editor `src/lib/tags.ts`, same test cases): `#` at line start or after whitespace,
    `(`, `,`, `;`; letters (any script), digits, `_`, `-`, `/`; at least one
    non-digit (`#123` is not a tag); case-insensitive, stored lower-case; trailing
    `/` dropped. Not tags: `a#b`, URLs, `](#anchor)`, `\#escaped`, code. Front
    matter `tags:` / `tag:` as `[a, b]`, `a, b` or a `- a` list.
  - Editor: tags are shown as small sky-blue pills (also inside headings; not in
    code, front matter or rendered tables); Ctrl+Click opens Global Search with
    `tag:<tag>`.
  - Right panel **Tags** tab: tag tree (nested tags under their parent, exact
    counts), expand a tag to list its notes (nested tags included), search button
    per tag. Refreshes on `search:indexed`.
  - Global Search: `tag:name` tokens filter (AND, nested tags included); tags alone
    list matching notes by path. Placeholder mentions it.
  - Index: `tags` table, `PRAGMA user_version` 2 (rebuilds older indexes once);
    `all_tags`, `notes_with_tag` commands. LIKE patterns are escaped so `_` in a tag
    is not a wildcard.
- **3.4** Global Search: filter by folder, case-sensitive and regex modes, replace in
  one note or across the vault (preview + confirm, writes go through the normal save
  path so sync and the watcher see them).
  - **As built:** Global Search keeps its ranked full-text mode by default. Turning
    on **Aa** (match case, Alt+C), whole word (Alt+W), **.\*** (regex, Alt+R) or the **Replace** toggle
    switches to an exact, line-by-line mode: results grouped by note (collapsible,
    match count), each line with its number and highlighted matches; click a line to
    open the note there. `path:folder` (one or more, OR) joins `tag:name` as a filter
    in both modes; folder names with spaces are quoted (`path:"My Notes"` or
    `path:'My Notes'`; an unclosed quote takes the rest of the query while typing).
    The rest of the query keeps its spacing (matters for regex).
    Results are capped (200 notes, 50 lines per note, 2000 lines) with a notice.
  - Whole word uses Unicode word boundaries; in plain mode only on a side that starts
    or ends with a letter/digit/`_` (so `#tag` still matches, as in VS Code), in regex
    mode around the whole pattern.
  - Replace: per-note checkboxes, matches shown struck through while a replacement is
    typed, "Replace all" asks for confirmation (count, notes, replacement). Regex mode
    expands `$1`; plain mode is literal. Line by line, so the preview count equals what
    is replaced. A note whose current match count differs from the preview is skipped
    and reported (never overwritten blindly). Before replacing, the open note's
    pending edits are saved; after, it is reloaded if it changed. Written notes are
    re-indexed at once.
  - Code: Rust `src-tauri/src/grep.rs` (pattern building, rejects invalid and
    empty-matching patterns; UTF-16 match ranges; tests), `search.rs`
    (`parse_filters`, folder filter, `grep`), `state.rs#replace_in_notes` (test),
    commands `grep_notes` / `replace_in_notes`. `regex` crate added (already in the
    dependency tree). Frontend `src/lib/grep.ts` (tests: `test-grep.mjs`),
    `GlobalSearch.tsx` rewritten.

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

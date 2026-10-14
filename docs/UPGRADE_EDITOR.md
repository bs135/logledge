# Implementation Plan: Obsidian-Style Inline Markdown Editor (Live Preview) for Logledge

## 1. Problem Statement & Motivation
Logledge currently uses **Milkdown Crepe** (`@milkdown/crepe`), which is built on **ProseMirror**. While functional as a rich-text WYSIWYG editor, it has significant drawbacks:
- It does not offer Obsidian's signature **Live Preview / Hybrid Editing** experience: seeing rich formatting by default, but revealing raw Markdown syntax (e.g., `**bold**`, `# Heading`, `[link](url)`) when clicking or placing the cursor directly on a node.
- ProseMirror converts Markdown into an abstract HTML-like DOM document tree on load and serializes it back to Markdown on save. This causes lossy formatting changes, alters custom line endings/whitespace, and makes granular inline syntax revealing technically fragile and prone to cursor jumps.
- Bundle size and memory footprint of Milkdown/ProseMirror are relatively heavy, conflicting with Logledge's core performance goals (<80MB idle RAM, <1s cold start).

## 2. Feasibility Assessment

### Can Milkdown (ProseMirror) achieve Obsidian-style Live Preview?
- **Feasibility**: **Extremely Low / Not Recommended**.
- **Reason**: In ProseMirror, syntax characters (like `**` or `#`) do not exist in the document state once parsed into nodes and marks. Attempting to inject them dynamically on cursor focus requires synthetic text insertion or complex decoration workarounds that interfere with ProseMirror's transaction history, cause cursor displacement, and pollute undo/redo stacks.

### What does Obsidian use?
- Obsidian completely re-architected its editor in v0.13 using **CodeMirror 6 (CM6)** specifically to implement Live Preview.
- CodeMirror 6 was explicitly designed with a modular `StateField` and `ViewPlugin` decoration architecture, operating on raw text documents with incremental Lezer syntax parsing.

### CodeMirror 6 (CM6) Feasibility for Logledge
- **Feasibility**: **Very High & Fully Proven**.
- **Architecture**:
  - The underlying state is 100% plain text (lossless, preserves exact user formatting, indentation, and frontmatter).
  - CodeMirror 6's `@lezer/markdown` incrementally parses the syntax tree.
  - A custom `StateField` applies decorations (`Decoration.mark`, `Decoration.replace`, `Decoration.widget`):
    - When the cursor or selection is **outside** a syntax element, decorations hide syntax markers and apply rich styling (headings, bold, italics, links, pills).
    - When the cursor **touches or enters** the element's character range or line, the hiding decoration is bypassed, revealing the raw Markdown characters in-place.
- **Performance Benefits**:
  - **Cold-start**: CM6 initializes in <50ms (compared to >250ms for Milkdown Crepe).
  - **Memory**: Tiny heap usage (~3–5MB per document), directly supporting Logledge's <80MB RAM target.
  - **Virtualization**: CM6 natively virtualizes line rendering, smoothly handling 100,000+ line notes.
  - **Bundle size**: Reduces frontend package footprint by ~70% compared to Milkdown Crepe.

---

## 3. Architecture & Technical Solution

### Core Dependencies
- `@codemirror/state` & `@codemirror/view`: Core CM6 state and DOM rendering pipeline.
- `@codemirror/language` & `@codemirror/lang-markdown`: Markdown language support with Lezer parser.
- `@lezer/markdown` & `@lezer/highlight`: AST inspection for headings, bold, italic, links, code blocks, task lists, tables.
- `@codemirror/commands`: Undo/redo history (`history`/`historyKeymap`) and standard keyboard navigation.

### Key Components to Implement
1. **`livePreview` (CM6 `StateField<DecorationSet>`)**:
   - A `StateField`, not a `ViewPlugin`, is required here: several decorations (horizontal
     rules, standalone images, fenced-code headers) are block-level widgets, and CodeMirror
     throws a `RangeError` for `block: true` decorations supplied by a `ViewPlugin`. As a
     consequence the field has no `view.visibleRanges` to limit itself to and walks the
     whole document's Lezer syntax tree on every doc change; on a selection-only change it
     only rebuilds when the old or new selection actually overlaps a node whose rendering
     is cursor-dependent (cached as `interactiveRanges`), keeping ordinary cursor movement
     through prose cheap.
   - Compares node ranges against `view.state.selection.main` (cursor position).
   - If cursor intersects: omit decoration -> raw syntax is visible.
   - If cursor outside:
     - **Headings**: Hide `# ` prefix with `Decoration.replace`, apply font-size and weight classes to line.
     - **Bold / Italic / Strikethrough**: Hide `**`, `*`, `~~` markers with `Decoration.replace`, wrap inner text with styled mark.
     - **Inline Code**: Hide the full backtick delimiter run (including multi-backtick spans), wrap in styled code badge.
     - **Links**: Hide `[` and `](url)` delimiters, style link text with primary color & underline.
     - **Horizontal Rule**: Replace `---` with `<hr>` divider widget.
     - **Task Lists**: Replace `[ ]` / `[x]` with an interactive checkbox widget (clicking directly toggles `[ ]` <-> `[x]` in text; the checkbox carries an `aria-label` derived from the task text).
2. **Block Widgets**:
   - **Fenced Code Blocks**: Syntax highlighted container with language label; reveals backticks when focused.
   - **Images**: Render inline image preview widget when cursor is away; reveals `![alt](url)` when cursor is placed on the line. Local Vault-relative sources are resolved through the Go backend (`ReadAttachmentDataURL`) as a `data:` URL, since the embedded AssetServer only serves bundled frontend assets.
3. **Logledge Integrations**:
   - **Attachment Handling**: Paste & drag-and-drop listener that extracts image files, calls Go backend `SaveAttachment`, and inserts a percent-encoded `![alt](.attachments/...)` link into the document.
   - **Auto-Save**: CM6 `EditorView.updateListener` triggered on document changes, debounced at 600ms matching Logledge's existing auto-save contract.
   - **Context Menu**: Re-bind existing `EditorContextMenu` actions (cut, copy, paste, select all, undo, redo) to CM6 dispatch commands.
   - **Theming & Typography**: Native Tailwind CSS v4 variables and Nunito font overrides seamlessly applied to `.cm-editor` classes.

---

## 4. Implementation Phasing & Task Breakdown

### Phase 1: Core Engine Migration
- Uninstall `@milkdown/crepe` and related packages.
- Install CodeMirror 6 packages (`@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/lang-markdown`, `@codemirror/commands`, `@lezer/markdown`, `@lezer/highlight`).
- Replace Milkdown initialization in `frontend/src/components/Editor.tsx` with a clean CM6 `EditorView`.
- Wire debounced auto-save (600ms) and note title rename handler.

### Phase 2: Live Preview Decoration Engine (Inline Syntax)
- Build the `livePreview` extension as a CM6 `StateField<DecorationSet>` (block decorations such as horizontal rules and standalone images cannot be supplied by a `ViewPlugin`).
- Implement cursor-aware decoration hiding for:
  - Headings (H1 to H6)
  - Bold (`**` / `__`), Italic (`*` / `_`), Strikethrough (`~~`)
  - Inline Code (`` `code` ``)
  - Horizontal rules (`---`, `***`)
  - Blockquotes (`>`)

### Phase 3: Interactive Links, Task Checkboxes & Attachments
- Implement interactive task list checkbox widgets (`- [ ]` / `- [x]`).
- Implement interactive links (`[text](url)` and WikiLinks `[[note]]`) with modifier-key navigation.
- Add image preview widgets and clipboard/drag-and-drop image attachment upload via Wails `SaveAttachment`.

### Phase 4: Context Menu, Theming & Polish
- Wire `EditorContextMenu` commands to CodeMirror 6 state dispatches.
- Apply Tailwind CSS v4 and Nunito font styles to `.cm-editor` in `style.css` for both light and dark modes.
- Ensure keyboard shortcuts (`Ctrl+B`, `Ctrl+I`, `Ctrl+Z`, `Ctrl+Y`) work smoothly.

### Phase 5: Verification & Performance Benchmarks
- Run `npm run build` in `frontend/` to ensure clean TypeScript compilation.
- Run `go build ./...` and `go test ./...` in the backend.
- Verify cold-start (<1s) and memory footprint (<80MB RAM).
- Update documentation in `docs/` and `copilot-instructions.md`.

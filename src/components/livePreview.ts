import {
    Decoration,
    DecorationSet,
    EditorView,
    WidgetType,
} from '@codemirror/view'
import { EditorState, Facet, Range, StateEffect, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { readAttachmentDataURL } from '../lib/api'
import { translate } from '../i18n'
import { parseWikiLink, resolveWikiLink, wikiLinkLabel } from '../lib/wikilink'

// All file paths in the vault, used to tell WikiLinks to existing notes apart from links
// to missing ones. `null` until the editor has been given the list: nothing is styled
// as missing then. Updated with the setNotePaths effect whenever the file tree changes.
export const setNotePaths = StateEffect.define<string[]>()
export const notePathsField = StateField.define<string[] | null>({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) if (e.is(setNotePaths)) value = e.value
        return value
    },
})

// Carries the active note's Vault-relative path into the StateField so the Image
// decoration can resolve local attachment sources (see ImageWidget/resolveAttachmentSrc).
export const notePathFacet = Facet.define<string, string>({
    combine: (values) => values[0] ?? '',
})

class CheckboxWidget extends WidgetType {
    constructor(
        readonly checked: boolean,
        readonly pos: number,
        readonly label: string
    ) {
        super()
    }

    eq(other: CheckboxWidget) {
        return (
            this.checked === other.checked &&
            this.pos === other.pos &&
            this.label === other.label
        )
    }

    toDOM(view: EditorView) {
        const wrap = document.createElement('span')
        wrap.className = 'cm-task-checkbox-wrap inline-flex items-center align-middle mr-1.5'
        const input = document.createElement('input')
        input.type = 'checkbox'
        input.checked = this.checked
        if (this.label) {
            input.setAttribute('aria-label', this.label)
        }
        input.className =
            'cm-task-checkbox h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-600 text-primary focus:ring-0 cursor-pointer accent-neutral-800 dark:accent-neutral-200'
        // Toggle on mousedown and cancel the default: otherwise CodeMirror moves the
        // cursor onto the marker first, which swaps this widget for raw `[ ]` text and
        // the later `click` never reaches the checkbox. Not taking focus also keeps the
        // editor's cursor where it was.
        input.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return
            e.preventDefault()
            this.toggle(view)
        })
        // The mousedown handler owns the state change; stop the native toggle so the
        // checkbox only reflects the document.
        input.addEventListener('click', (e) => e.preventDefault())
        input.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                this.toggle(view)
            }
        })
        wrap.appendChild(input)
        return wrap
    }

    private toggle(view: EditorView) {
        view.dispatch({
            changes: { from: this.pos, to: this.pos + 3, insert: this.checked ? '[ ]' : '[x]' },
            userEvent: 'input.toggle',
        })
    }

    // Keep CodeMirror from handling events on the checkbox (selection, drag start).
    ignoreEvent() {
        return true
    }
}

// Bullet glyphs by list nesting level (1-based), cycling for deeper levels.
const BULLET_GLYPHS = ['•', '◦', '▪']

export class BulletWidget extends WidgetType {
    constructor(readonly depth: number) {
        super()
    }

    eq(other: BulletWidget) {
        return this.depth === other.depth
    }

    toDOM() {
        const el = document.createElement('span')
        el.className = `cm-list-bullet cm-list-bullet-${((this.depth - 1) % BULLET_GLYPHS.length) + 1}`
        el.textContent = BULLET_GLYPHS[(this.depth - 1) % BULLET_GLYPHS.length]
        el.setAttribute('aria-hidden', 'true')
        return el
    }

    ignoreEvent() {
        return false
    }
}

class HrWidget extends WidgetType {
    eq() {
        return true
    }

    toDOM() {
        // Spacing uses padding (not margin) because this is rendered as a block decoration:
        // CodeMirror measures the widget's own box for line-height purposes and does not
        // account for margins on block widgets, which would desync the editor's layout model.
        const wrap = document.createElement('div')
        wrap.className = 'cm-hr-widget py-3 w-full'
        const line = document.createElement('div')
        line.className = 'h-px bg-neutral-200 dark:bg-neutral-800 w-full'
        wrap.appendChild(line)
        return wrap
    }
}

// Matches an absolute URL (http:, https:, data:, etc.) or a protocol-relative "//" URL.
// Anything else is treated as a Vault-relative path that the embedded AssetServer
// cannot resolve directly and must be read from disk instead (see resolveAttachmentSrc).
const absoluteOrDataUrlPattern = /^([a-z][a-z0-9+.-]*:|\/\/)/i

// Caches in-flight/completed attachment reads so the same image is not re-read from
// disk every time its decoration is recreated (e.g. on cursor movement elsewhere).
const attachmentDataUrlCache = new Map<string, Promise<string>>()

function resolveAttachmentSrc(notePath: string, src: string): Promise<string> {
    const cacheKey = `${notePath}\u0000${src}`
    let pending = attachmentDataUrlCache.get(cacheKey)
    if (!pending) {
        pending = readAttachmentDataURL(notePath, src).catch((err) => {
            attachmentDataUrlCache.delete(cacheKey)
            throw err
        })
        attachmentDataUrlCache.set(cacheKey, pending)
    }
    return pending
}

class ImageWidget extends WidgetType {
    constructor(
        readonly src: string,
        readonly alt: string,
        readonly notePath: string
    ) {
        super()
    }

    eq(other: ImageWidget) {
        return (
            this.src === other.src &&
            this.alt === other.alt &&
            this.notePath === other.notePath
        )
    }

    toDOM() {
        // Padding rather than margin: see HrWidget for why block-decoration widgets must
        // confine their own height to padding/border instead of (uncounted) margins.
        const wrap = document.createElement('div')
        wrap.className = 'cm-image-widget py-2 block'
        const img = document.createElement('img')
        img.alt = this.alt
        img.className =
            'max-w-full max-h-[450px] rounded-md border border-neutral-200 dark:border-neutral-700/60 shadow-sm object-contain'
        img.loading = 'lazy'
        if (absoluteOrDataUrlPattern.test(this.src)) {
            img.src = this.src
        } else {
            // Vault-relative path (e.g. "../.attachments/foo.png"): the embedded
            // AssetServer only serves bundled frontend assets, so resolve it through
            // the backend as a data: URL instead of assigning it as an HTTP src.
            resolveAttachmentSrc(this.notePath, this.src)
                .then((dataUrl) => {
                    img.src = dataUrl
                })
                .catch((err) => {
                    console.error('Failed to resolve local attachment image:', err)
                })
        }
        wrap.appendChild(img)
        return wrap
    }
}

// ---- GFM tables -------------------------------------------------------------------
// A table not touched by the selection is replaced by a block widget that renders it as
// an HTML <table>. The widget only receives a plain data model (built from the syntax
// tree in buildTableData) so that `eq` can cheaply decide whether the DOM can be reused.

type TableInline =
    | { t: 'text'; text: string }
    | { t: 'code'; text: string }
    | { t: 'wiki'; text: string; missing?: boolean }
    | { t: 'strong' | 'em' | 'strike'; children: TableInline[] }
    | { t: 'link'; url: string; children: TableInline[] }

type TableAlign = 'left' | 'center' | 'right' | null

interface TableCellData {
    // Document position of the cell's content (or of the gap between its pipes when the
    // cell is empty); clicking the cell puts the cursor there.
    from: number
    content: TableInline[]
}

interface TableData {
    aligns: TableAlign[]
    header: TableCellData[]
    rows: TableCellData[][]
}

// Inline elements whose markup is revealed as a whole when the cursor is inside them; an
// escape inside one is revealed at the same time.
const INLINE_SCOPE_NODES = new Set(['Link', 'Image', 'Emphasis', 'StrongEmphasis', 'Strikethrough'])

// Syntax nodes that are pure markup inside inline formatting and never shown as text.
const INLINE_MARK_NODES = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark', 'LinkMark'])

function pushText(out: TableInline[], text: string) {
    if (!text) return
    const prev = out[out.length - 1]
    if (prev?.t === 'text') prev.text += text
    else out.push({ t: 'text', text })
}

// "[[Note]]" is not part of the Lezer grammar (it is styled by a raw-text scan in
// buildDecorations; Lezer even parses its inner "[Note]" as a reference Link), so it is
// split out of the already-merged plain text runs here.
function splitWikiLinks(items: TableInline[]): TableInline[] {
    const out: TableInline[] = []
    for (const item of items) {
        if (item.t !== 'text') {
            out.push(item)
            continue
        }
        const wikiRegex = /\[\[([^\]]+)\]\]/g
        let last = 0
        let m: RegExpExecArray | null
        while ((m = wikiRegex.exec(item.text)) !== null) {
            if (m.index > last) out.push({ t: 'text', text: item.text.slice(last, m.index) })
            out.push({ t: 'wiki', text: m[1] })
            last = m.index + m[0].length
        }
        if (last < item.text.length) out.push({ t: 'text', text: item.text.slice(last) })
    }
    return out
}

// Converts the inline content of `node` between `from` and `to` into TableInline items.
function tableInlines(
    doc: EditorState['doc'],
    node: SyntaxNode,
    from: number,
    to: number
): TableInline[] {
    const out: TableInline[] = []
    let pos = from
    for (let child = node.firstChild; child; child = child.nextSibling) {
        if (child.to <= from || child.from >= to) continue
        if (child.from > pos) pushText(out, doc.sliceString(pos, child.from))
        pos = Math.max(pos, child.to)
        const name = child.name
        if (INLINE_MARK_NODES.has(name)) continue
        if (name === 'StrongEmphasis' || name === 'Emphasis' || name === 'Strikethrough') {
            const t = name === 'StrongEmphasis' ? 'strong' : name === 'Emphasis' ? 'em' : 'strike'
            out.push({ t, children: tableInlines(doc, child, child.from, child.to) })
        } else if (name === 'InlineCode') {
            let codeFrom = child.from
            let codeTo = child.to
            const first = child.firstChild
            const last = child.lastChild
            if (first?.name === 'CodeMark') codeFrom = first.to
            if (last?.name === 'CodeMark' && last !== first) codeTo = last.from
            out.push({ t: 'code', text: doc.sliceString(codeFrom, codeTo) })
        } else if (name === 'Link') {
            const marks = child.getChildren('LinkMark')
            const url = child.getChild('URL')
            if (marks.length >= 2 && url) {
                out.push({
                    t: 'link',
                    url: doc.sliceString(url.from, url.to),
                    children: tableInlines(doc, child, marks[0].to, marks[1].from),
                })
            } else {
                pushText(out, doc.sliceString(child.from, child.to))
            }
        } else if (name === 'Escape') {
            pushText(out, doc.sliceString(child.from + 1, child.to))
        } else {
            pushText(out, doc.sliceString(child.from, child.to))
        }
    }
    if (pos < to) pushText(out, doc.sliceString(pos, to))
    return splitWikiLinks(out)
}

// Splits a TableHeader/TableRow into cells at its `|` delimiters. Lezer omits TableCell
// nodes for empty cells, so cells are derived from the gaps between delimiters rather
// than from the TableCell nodes alone.
function tableRowCells(doc: EditorState['doc'], row: SyntaxNode): TableCellData[] {
    const delims = row.getChildren('TableDelimiter')
    const cellNodes = row.getChildren('TableCell')
    const gaps: [number, number][] = []
    if (delims.length === 0) {
        gaps.push([row.from, row.to])
    } else {
        if (doc.sliceString(row.from, delims[0].from).trim()) gaps.push([row.from, delims[0].from])
        for (let i = 0; i + 1 < delims.length; i++) gaps.push([delims[i].to, delims[i + 1].from])
        const lastTo = delims[delims.length - 1].to
        if (doc.sliceString(lastTo, row.to).trim()) gaps.push([lastTo, row.to])
    }
    return gaps.map(([gapFrom, gapTo]) => {
        const cell = cellNodes.find((c) => c.from >= gapFrom && c.to <= gapTo)
        if (!cell) return { from: gapFrom, content: [] }
        return { from: cell.from, content: tableInlines(doc, cell, cell.from, cell.to) }
    })
}

function parseTableAligns(delimiterRow: string): TableAlign[] {
    return delimiterRow
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((spec) => {
            const s = spec.trim()
            const left = s.startsWith(':')
            const right = s.endsWith(':')
            if (left && right) return 'center'
            if (right) return 'right'
            if (left) return 'left'
            return null
        })
}

function buildTableData(doc: EditorState['doc'], table: SyntaxNode): TableData | null {
    const headerNode = table.getChild('TableHeader')
    if (!headerNode) return null
    // The delimiter row (|---|:-:|) is a TableDelimiter directly under Table.
    const delimRow = table.getChildren('TableDelimiter')[0]
    const header = tableRowCells(doc, headerNode)
    const cols = header.length
    const aligns = delimRow ? parseTableAligns(doc.sliceString(delimRow.from, delimRow.to)) : []
    const rows = table.getChildren('TableRow').map((rowNode) => {
        // GFM: body rows are padded with empty cells / truncated to the header's width.
        const cells = tableRowCells(doc, rowNode).slice(0, cols)
        while (cells.length < cols) cells.push({ from: rowNode.to, content: [] })
        return cells
    })
    return { aligns: header.map((_, i) => aligns[i] ?? null), header, rows }
}

const WIKILINK_CLASS =
    'cm-wikilink text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-0.5 rounded cursor-pointer font-medium'
// A link to a note that does not exist yet: same box as WIKILINK_CLASS (padding, radius,
// weight) so both kinds take the same space, but dimmed, no background, wavy underline.
const WIKILINK_MISSING_CLASS =
    'cm-wikilink cm-wikilink-missing text-purple-500/70 dark:text-purple-400/60 px-1.5 py-0.5 rounded cursor-pointer font-medium underline decoration-wavy underline-offset-4 decoration-purple-400/60'

// Flags table-cell WikiLinks that point at missing notes. The flag is part of the widget
// data, so the table is redrawn when a note is created or deleted.
function markMissingWikiLinks(data: TableData, isMissing: (raw: string) => boolean) {
    const walk = (items: TableInline[]) => {
        for (const item of items) {
            if (item.t === 'wiki') {
                if (isMissing(item.text)) item.missing = true
            } else if ('children' in item) walk(item.children)
        }
    }
    for (const cell of data.header) walk(cell.content)
    for (const row of data.rows) for (const cell of row) walk(cell.content)
}

function appendTableInlines(parent: HTMLElement, items: TableInline[]) {
    for (const item of items) {
        switch (item.t) {
            case 'text':
                parent.appendChild(document.createTextNode(item.text))
                break
            case 'code': {
                const el = document.createElement('code')
                el.className =
                    'cm-inline-code font-mono text-[0.875em] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-red-500 dark:text-red-400 border border-neutral-200 dark:border-neutral-700/60'
                el.textContent = item.text
                parent.appendChild(el)
                break
            }
            case 'wiki': {
                const el = document.createElement('span')
                el.className = item.missing ? WIKILINK_MISSING_CLASS : WIKILINK_CLASS
                el.setAttribute('data-wiki-target', item.text)
                el.title = translate(item.missing ? 'wikiLinkMissingTitle' : 'wikiLinkTitle')
                el.textContent = wikiLinkLabel(item.text)
                parent.appendChild(el)
                break
            }
            case 'link': {
                // Same class/attributes as inline links so Editor's Ctrl+Click handler
                // opens them from inside the table too.
                const el = document.createElement('span')
                el.className =
                    'cm-link text-blue-600 dark:text-blue-400 underline underline-offset-2 decoration-blue-300 dark:decoration-blue-600 hover:decoration-blue-500 cursor-pointer'
                el.setAttribute('data-url', item.url)
                el.title = `Ctrl+Click to open ${item.url}`
                appendTableInlines(el, item.children)
                parent.appendChild(el)
                break
            }
            default: {
                const el = document.createElement(
                    item.t === 'strong' ? 'strong' : item.t === 'em' ? 'em' : 's'
                )
                if (item.t === 'strong') el.className = 'font-bold text-neutral-900 dark:text-neutral-100'
                if (item.t === 'strike') el.className = 'line-through opacity-70'
                appendTableInlines(el, item.children)
                parent.appendChild(el)
            }
        }
    }
}

export class TableWidget extends WidgetType {
    private readonly key: string

    constructor(
        readonly data: TableData,
        readonly tableFrom: number
    ) {
        super()
        this.key = JSON.stringify(data)
    }

    eq(other: TableWidget) {
        return this.tableFrom === other.tableFrom && this.key === other.key
    }

    toDOM(view: EditorView) {
        // Padding rather than margin: see HrWidget for why block-decoration widgets must
        // confine their own height to padding/border instead of (uncounted) margins.
        const wrap = document.createElement('div')
        wrap.className = 'cm-table-widget py-2 overflow-x-auto'
        const table = document.createElement('table')
        table.className = 'cm-table'

        const addRow = (section: HTMLElement, cells: TableCellData[], tag: 'th' | 'td') => {
            const tr = document.createElement('tr')
            cells.forEach((cell, i) => {
                const el = document.createElement(tag)
                const align = this.data.aligns[i]
                if (align) el.style.textAlign = align
                el.setAttribute('data-from', String(cell.from))
                appendTableInlines(el, cell.content)
                tr.appendChild(el)
            })
            section.appendChild(tr)
        }

        const thead = document.createElement('thead')
        addRow(thead, this.data.header, 'th')
        table.appendChild(thead)
        if (this.data.rows.length) {
            const tbody = document.createElement('tbody')
            for (const row of this.data.rows) addRow(tbody, row, 'td')
            table.appendChild(tbody)
        }
        wrap.appendChild(table)

        // Clicking a cell reveals the raw markdown with the cursor at that cell. Ctrl/Cmd
        // clicks on links are left alone so Editor's link handler can open them.
        wrap.addEventListener('mousedown', (e) => {
            const target = e.target as HTMLElement | null
            if ((e.ctrlKey || e.metaKey) && target?.closest('.cm-link, .cm-wikilink')) return
            e.preventDefault()
            const cellEl = target?.closest('[data-from]')
            const pos = cellEl ? Number(cellEl.getAttribute('data-from')) : this.tableFrom
            view.dispatch({ selection: { anchor: pos } })
            view.focus()
        })
        return wrap
    }
}

function copyToClipboard(text: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text)
    }
    return new Promise((resolve, reject) => {
        try {
            if (typeof document === 'undefined') {
                resolve()
                return
            }
            const textarea = document.createElement('textarea')
            textarea.value = text
            textarea.style.position = 'fixed'
            textarea.style.opacity = '0'
            document.body.appendChild(textarea)
            textarea.select()
            const success = document.execCommand('copy')
            document.body.removeChild(textarea)
            if (success) resolve()
            else reject(new Error('execCommand copy failed'))
        } catch (err) {
            reject(err)
        }
    })
}

export class CodeBlockHeaderWidget extends WidgetType {
    constructor(
        readonly lang: string,
        readonly code: string,
        readonly lineFrom: number
    ) {
        super()
    }

    eq(other: CodeBlockHeaderWidget) {
        return (
            this.lang === other.lang &&
            this.code === other.code &&
            this.lineFrom === other.lineFrom
        )
    }

    toDOM(view: EditorView) {
        // Rendered inline inside the fence line (which keeps its code-block line styling),
        // so it must stay shorter than that line's height and not add its own box chrome.
        const header = document.createElement('span')
        header.className =
            'cm-codeblock-header select-none text-neutral-400 dark:text-neutral-500 font-sans leading-none'

        // Language label badge
        const leftWrap = document.createElement('div')
        leftWrap.className = 'flex items-center gap-1.5 leading-none'

        if (this.lang) {
            const langBadge = document.createElement('span')
            langBadge.className =
                'font-mono text-[0.625em] font-medium tracking-wider uppercase text-neutral-400 dark:text-neutral-500 leading-none select-none'
            langBadge.textContent = this.lang
            leftWrap.appendChild(langBadge)
        }
        header.appendChild(leftWrap)

        // Copy button
        const copyBtn = document.createElement('button')
        copyBtn.type = 'button'
        copyBtn.className =
            'cm-codeblock-copy-btn flex items-center gap-1 px-1 py-[1px] rounded transition-colors duration-150 text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 cursor-pointer font-sans text-[0.625em] leading-none'
        copyBtn.title = translate('codeCopyTitle')

        copyBtn.innerHTML = `
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
            </svg>
            <span class="cm-copy-text leading-none">${translate('copy')}</span>
        `

        let copyTimeout: ReturnType<typeof setTimeout> | null = null
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation()
            e.preventDefault()
            if (!this.code) return

            copyToClipboard(this.code).then(() => {
                copyBtn.classList.add('text-emerald-600', 'dark:text-emerald-400')
                copyBtn.innerHTML = `
                    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20 6 9 17l-5-5"/>
                    </svg>
                    <span class="cm-copy-text leading-none">${translate('codeCopied')}</span>
                `
                if (copyTimeout) clearTimeout(copyTimeout)
                copyTimeout = setTimeout(() => {
                    copyBtn.classList.remove('text-emerald-600', 'dark:text-emerald-400')
                    copyBtn.innerHTML = `
                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                        </svg>
                        <span class="cm-copy-text leading-none">${translate('copy')}</span>
                    `
                }, 1500)
            }).catch((err) => {
                console.error('Failed to copy code block:', err)
            })
        })

        header.appendChild(copyBtn)

        // Clicking anywhere on the header (except copy button) focuses start line and reveals raw markdown
        header.addEventListener('mousedown', (e) => {
            if ((e.target as HTMLElement)?.closest('.cm-codeblock-copy-btn')) return
            view.dispatch({
                selection: { anchor: this.lineFrom, head: this.lineFrom },
                scrollIntoView: false,
            })
            view.focus()
        })

        return header
    }

    ignoreEvent(event: Event): boolean {
        if ((event.target as HTMLElement)?.closest('.cm-codeblock-copy-btn')) {
            return true
        }
        return false
    }
}

// Line class shared by every line of a fenced code block. It must not depend on whether
// the block is rendered (view mode) or revealed as raw markdown (code mode): any difference
// in font size, line height, padding or margin makes the block change height on toggle.
function codeblockLineClass(first: boolean, last: boolean, footer: boolean): string {
    let cls =
        'cm-codeblock-line font-mono text-[0.875em] bg-neutral-100/70 dark:bg-neutral-800/50 py-0.5'
    if (first) cls += ' cm-codeblock-first'
    if (last) cls += ' cm-codeblock-last'
    if (footer) cls += ' cm-codeblock-footer'
    return cls
}

// A node range whose rendering toggles between "rendered" and "raw markdown" depending
// on whether the cursor/selection currently overlaps it (see buildDecorations below).
interface InteractiveRange {
    from: number
    to: number
}

interface BuildResult {
    decorations: DecorationSet
    // Every selection-sensitive range built this pass, used by the StateField to decide
    // whether a selection-only update can reuse the previous decorations unchanged.
    interactiveRanges: InteractiveRange[]
}

function rangesOverlap(ranges: InteractiveRange[], from: number, to: number): boolean {
    for (const r of ranges) {
        if (r.from <= to && r.to >= from) return true
    }
    return false
}

// Decorations are computed in a StateField (rather than a ViewPlugin) because several of
// them (horizontal rules, standalone images, fenced-code headers) are block-level widgets
// that replace an entire line. CodeMirror throws a RangeError ("Block decorations may not
// be specified via plugins") for `block: true` decorations supplied by a ViewPlugin, and
// treating them as inline instead desyncs the view's line-height/position model from the
// actual rendered DOM -- which is what caused clicks and Up/Down navigation to land on the
// wrong line. A StateField has no `view.visibleRanges` to limit scanning to, so this walks
// the whole document on every doc change. To keep cursor-only movement cheap despite that,
// buildDecorations also returns every selection-sensitive node range (`interactiveRanges`);
// the StateField's `update` skips rebuilding entirely when the old and new selection
// overlap the exact same set of those ranges (see livePreview below), which covers the
// common case of moving the cursor through plain prose.
function buildDecorations(state: EditorState): BuildResult {
    const doc = state.doc
    const selection = state.selection.main
    const selFrom = selection.from
    const selTo = selection.to
    const notePath = state.facet(notePathFacet)
    const notePaths = state.field(notePathsField, false) ?? null
    // True when the link points at a note that does not exist. Same-note links
    // ([[#Heading]]) and an unknown file list never count as missing.
    const isMissingLink = (raw: string): boolean => {
        if (!notePaths) return false
        const { target } = parseWikiLink(raw)
        return target !== '' && resolveWikiLink(target, notePaths, notePath || null) === null
    }

    const decorations: Range<Decoration>[] = []
    const interactiveRanges: InteractiveRange[] = []
    // Ranges recognized as "code" (inline code spans and fenced code blocks), used to
    // keep the raw-text WikiLink scan below from decorating "[[...]]" examples that
    // appear inside code rather than as actual prose links.
    const codeRanges: InteractiveRange[] = []
    // Tables currently replaced by a TableWidget; the WikiLink scan below must not add
    // decorations inside them (the widget renders "[[...]]" itself).
    const renderedTableRanges: InteractiveRange[] = []
    const visitedHeadingLines = new Set<number>()
    // Deepest blockquote nesting level seen on each line (keyed by line.from). Filled while
    // walking the tree and turned into line decorations once the walk is done, because an
    // outer Blockquote is entered before its nested ones and must not claim their lines.
    const blockquoteDepth = new Map<number, number>()
    const visitedCodeblockLines = new Set<number>()

    const tree = syntaxTree(state)

    tree.iterate({
        from: 0,
        to: doc.length,
        enter: (node) => {
            const nodeFrom = node.from
            const nodeTo = node.to
            const name = node.name

            // 1. Headings (ATXHeading1 to ATXHeading6)
            if (name.startsWith('ATXHeading')) {
                const levelStr = name.replace('ATXHeading', '')
                const level = parseInt(levelStr, 10)
                if (level >= 1 && level <= 6) {
                    const line = doc.lineAt(nodeFrom)
                    if (!visitedHeadingLines.has(line.from)) {
                        visitedHeadingLines.add(line.from)
                        decorations.push(
                            Decoration.line({
                                class: `cm-heading cm-heading-${level}`,
                            }).range(line.from)
                        )

                        const match = line.text.match(/^(#{1,6}\s*)/)
                        if (match) {
                            const prefixLen = match[1].length
                            const prefixFrom = line.from
                            const prefixTo = line.from + prefixLen
                            const isLineActive = selFrom <= line.to && selTo >= line.from
                            interactiveRanges.push({ from: line.from, to: line.to })

                            if (!isLineActive) {
                                decorations.push(
                                    Decoration.replace({}).range(prefixFrom, prefixTo)
                                )
                            } else {
                                decorations.push(
                                    Decoration.mark({
                                        class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono font-normal select-none',
                                    }).range(prefixFrom, prefixTo)
                                )
                            }
                        }
                    }
                }
                return
            }

            // Backslash escapes (\[ \* \# ...): the backslash is hidden like other markup.
            // It is revealed together with the inline element it belongs to (a link's
            // syntax is revealed as a whole), or on its own in plain text.
            if (name === 'Escape') {
                const parent = node.node.parent
                const scope = parent && INLINE_SCOPE_NODES.has(parent.name) ? parent : node.node
                const isCursorInside = selFrom <= scope.to && selTo >= scope.from
                interactiveRanges.push({ from: scope.from, to: scope.to })
                decorations.push(
                    isCursorInside
                        ? Decoration.mark({ class: 'cm-formatting text-neutral-400 dark:text-neutral-500' }).range(nodeFrom, nodeFrom + 1)
                        : Decoration.replace({}).range(nodeFrom, nodeFrom + 1)
                )
                return
            }

            // 2. Strong Emphasis (**bold** or __bold__)
            if (name === 'StrongEmphasis') {
                if (nodeTo - nodeFrom >= 4) {
                    const isCursorInside = selFrom <= nodeTo && selTo >= nodeFrom
                    interactiveRanges.push({ from: nodeFrom, to: nodeTo })
                    if (!isCursorInside) {
                        decorations.push(
                            Decoration.replace({}).range(nodeFrom, nodeFrom + 2)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'font-bold text-neutral-900 dark:text-neutral-100',
                            }).range(nodeFrom + 2, nodeTo - 2)
                        )
                        decorations.push(
                            Decoration.replace({}).range(nodeTo - 2, nodeTo)
                        )
                    } else {
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono font-normal',
                            }).range(nodeFrom, nodeFrom + 2)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'font-bold text-neutral-900 dark:text-neutral-100',
                            }).range(nodeFrom + 2, nodeTo - 2)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono font-normal',
                            }).range(nodeTo - 2, nodeTo)
                        )
                    }
                }
                return
            }

            // 3. Emphasis (*italic* or _italic_)
            if (name === 'Emphasis') {
                if (nodeTo - nodeFrom >= 2) {
                    const isCursorInside = selFrom <= nodeTo && selTo >= nodeFrom
                    interactiveRanges.push({ from: nodeFrom, to: nodeTo })
                    if (!isCursorInside) {
                        decorations.push(
                            Decoration.replace({}).range(nodeFrom, nodeFrom + 1)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'italic',
                            }).range(nodeFrom + 1, nodeTo - 1)
                        )
                        decorations.push(
                            Decoration.replace({}).range(nodeTo - 1, nodeTo)
                        )
                    } else {
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono font-normal',
                            }).range(nodeFrom, nodeFrom + 1)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'italic',
                            }).range(nodeFrom + 1, nodeTo - 1)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono font-normal',
                            }).range(nodeTo - 1, nodeTo)
                        )
                    }
                }
                return
            }

            // 4. Strikethrough (~~text~~)
            if (name === 'Strikethrough') {
                if (nodeTo - nodeFrom >= 4) {
                    const isCursorInside = selFrom <= nodeTo && selTo >= nodeFrom
                    interactiveRanges.push({ from: nodeFrom, to: nodeTo })
                    if (!isCursorInside) {
                        decorations.push(
                            Decoration.replace({}).range(nodeFrom, nodeFrom + 2)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'line-through opacity-70',
                            }).range(nodeFrom + 2, nodeTo - 2)
                        )
                        decorations.push(
                            Decoration.replace({}).range(nodeTo - 2, nodeTo)
                        )
                    } else {
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono font-normal',
                            }).range(nodeFrom, nodeFrom + 2)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'line-through opacity-70',
                            }).range(nodeFrom + 2, nodeTo - 2)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono font-normal',
                            }).range(nodeTo - 2, nodeTo)
                        )
                    }
                }
                return
            }

            // 5. Inline Code (`code`, or multi-backtick spans like ``a ` b``)
            if (name === 'InlineCode') {
                const text = doc.sliceString(nodeFrom, nodeTo)
                let openLen = 0
                while (openLen < text.length && text[openLen] === '`') openLen++
                let closeLen = 0
                while (
                    closeLen < text.length - openLen &&
                    text[text.length - 1 - closeLen] === '`'
                ) {
                    closeLen++
                }
                if (openLen > 0 && closeLen > 0 && nodeTo - nodeFrom > openLen + closeLen) {
                    codeRanges.push({ from: nodeFrom, to: nodeTo })
                    interactiveRanges.push({ from: nodeFrom, to: nodeTo })
                    const isCursorInside = selFrom <= nodeTo && selTo >= nodeFrom
                    if (!isCursorInside) {
                        decorations.push(
                            Decoration.replace({}).range(nodeFrom, nodeFrom + openLen)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-inline-code font-mono text-[0.875em] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-red-500 dark:text-red-400 border border-neutral-200 dark:border-neutral-700/60',
                            }).range(nodeFrom + openLen, nodeTo - closeLen)
                        )
                        decorations.push(
                            Decoration.replace({}).range(nodeTo - closeLen, nodeTo)
                        )
                    } else {
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-[0.75em]',
                            }).range(nodeFrom, nodeFrom + openLen)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-inline-code font-mono text-[0.875em] bg-neutral-100/50 dark:bg-neutral-800/50 text-red-500 dark:text-red-400',
                            }).range(nodeFrom + openLen, nodeTo - closeLen)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-[0.75em]',
                            }).range(nodeTo - closeLen, nodeTo)
                        )
                    }
                }
                return
            }

            // 6. Horizontal Rule (--- or ***)
            if (name === 'HorizontalRule') {
                const line = doc.lineAt(nodeFrom)
                const isLineActive = selFrom <= line.to && selTo >= line.from
                interactiveRanges.push({ from: line.from, to: line.to })
                if (!isLineActive) {
                    decorations.push(
                        Decoration.replace({
                            widget: new HrWidget(),
                            block: true,
                        }).range(line.from, line.to)
                    )
                } else {
                    decorations.push(
                        Decoration.mark({
                            class: 'font-mono text-neutral-400 dark:text-neutral-500 font-bold',
                        }).range(nodeFrom, nodeTo)
                    )
                }
                return
            }

            // 7. TaskMarker ([ ] or [x])
            if (name === 'TaskMarker') {
                if (nodeTo - nodeFrom === 3) {
                    const isCursorOnMarker = selFrom <= nodeTo && selTo >= nodeFrom
                    interactiveRanges.push({ from: nodeFrom, to: nodeTo })
                    if (!isCursorOnMarker) {
                        const text = doc.sliceString(nodeFrom, nodeTo)
                        const isChecked = text.toLowerCase() === '[x]'
                        const line = doc.lineAt(nodeFrom)
                        const label = line.text.slice(nodeTo - line.from).trim()
                        decorations.push(
                            Decoration.replace({
                                widget: new CheckboxWidget(isChecked, nodeFrom, label),
                            }).range(nodeFrom, nodeTo)
                        )
                    } else {
                        decorations.push(
                            Decoration.mark({
                                class: 'font-mono text-neutral-500 font-bold',
                            }).range(nodeFrom, nodeTo)
                        )
                    }
                }
                return
            }

            // 8. Link ([text](url))
            if (name === 'Link') {
                const linkStr = doc.sliceString(nodeFrom, nodeTo)
                const splitIdx = linkStr.indexOf('](')
                if (splitIdx > 1 && linkStr.endsWith(')')) {
                    const labelEnd = nodeFrom + splitIdx
                    const url = linkStr.slice(splitIdx + 2, -1)
                    const isCursorInside = selFrom <= nodeTo && selTo >= nodeFrom
                    interactiveRanges.push({ from: nodeFrom, to: nodeTo })
                    if (!isCursorInside) {
                        // Hide [
                        decorations.push(
                            Decoration.replace({}).range(nodeFrom, nodeFrom + 1)
                        )
                        // Style label
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-link text-blue-600 dark:text-blue-400 underline underline-offset-2 decoration-blue-300 dark:decoration-blue-600 hover:decoration-blue-500 cursor-pointer',
                                attributes: {
                                    'data-url': url,
                                    title: `Ctrl+Click to open ${url}`,
                                },
                            }).range(nodeFrom + 1, labelEnd)
                        )
                        // Hide ](url)
                        decorations.push(
                            Decoration.replace({}).range(labelEnd, nodeTo)
                        )
                    } else {
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-[0.75em]',
                            }).range(nodeFrom, nodeFrom + 1)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'text-blue-600 dark:text-blue-400 underline underline-offset-2',
                            }).range(nodeFrom + 1, labelEnd)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-[0.75em]',
                            }).range(labelEnd, nodeTo)
                        )
                    }
                }
                return
            }

            // 9. Image (![alt](url))
            if (name === 'Image') {
                const imgStr = doc.sliceString(nodeFrom, nodeTo)
                const match = imgStr.match(/^!\[(.*?)\]\((.*?)\)$/)
                if (match) {
                    const alt = match[1]
                    const src = match[2]
                    const isCursorInside = selFrom <= nodeTo && selTo >= nodeFrom
                    interactiveRanges.push({ from: nodeFrom, to: nodeTo })
                    if (!isCursorInside) {
                        // An image that is the sole content of its line is rendered as a
                        // block widget (it visually occupies the whole line anyway); an
                        // image inline with surrounding text stays an inline widget.
                        const line = doc.lineAt(nodeFrom)
                        const isStandalone = line.text.trim() === imgStr
                        decorations.push(
                            Decoration.replace({
                                widget: new ImageWidget(src, alt, notePath),
                                block: isStandalone,
                            }).range(
                                isStandalone ? line.from : nodeFrom,
                                isStandalone ? line.to : nodeTo
                            )
                        )
                    } else {
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting font-mono text-[0.75em] text-neutral-400 dark:text-neutral-500',
                            }).range(nodeFrom, nodeTo)
                        )
                    }
                }
                return
            }

            // 9b. GFM Table: rendered as an HTML table unless the selection touches it,
            // in which case the raw markdown is shown with dimmed pipes.
            if (name === 'Table') {
                const startLine = doc.lineAt(nodeFrom)
                const endLine = doc.lineAt(nodeTo)
                interactiveRanges.push({ from: startLine.from, to: endLine.to })
                const isActive = state.selection.ranges.some(
                    (r) => r.from <= endLine.to && r.to >= startLine.from
                )
                // Only top-level tables become a block widget: inside a blockquote or list
                // item the replaced lines would also swallow the container's markers.
                const isTopLevel = node.node.parent?.name === 'Document'
                if (isActive || !isTopLevel) return
                const data = buildTableData(doc, node.node)
                if (!data) return
                markMissingWikiLinks(data, isMissingLink)
                renderedTableRanges.push({ from: startLine.from, to: endLine.to })
                decorations.push(
                    Decoration.replace({
                        widget: new TableWidget(data, startLine.from),
                        block: true,
                    }).range(startLine.from, endLine.to)
                )
                // The widget renders the cell contents itself.
                return false
            }

            if (name === 'TableDelimiter') {
                decorations.push(
                    Decoration.mark({
                        class: 'cm-formatting text-neutral-400 dark:text-neutral-500',
                    }).range(nodeFrom, nodeTo)
                )
                return
            }

            // 9c. Unordered list marker (-, *, +): replaced by a bullet glyph chosen by
            // nesting level when the cursor is off the line, shown dimmed when it is on it.
            // Ordered list markers ("1.") are left as they are.
            if (name === 'ListMark') {
                const item = node.node.parent
                const list = item?.parent
                const line = doc.lineAt(nodeFrom)
                // Nested-list indentation is plain spaces, which are very narrow in the
                // proportional editor font. Render it in monospace (in both modes, so the
                // text does not shift when the cursor enters the line).
                if (nodeFrom > line.from && /^[ \t]+$/.test(doc.sliceString(line.from, nodeFrom))) {
                    decorations.push(
                        Decoration.mark({ class: 'cm-list-indent' }).range(line.from, nodeFrom)
                    )
                }
                if (!item || list?.name !== 'BulletList') return
                const isLineActive = selFrom <= line.to && selTo >= line.from
                interactiveRanges.push({ from: line.from, to: line.to })
                if (isLineActive) {
                    decorations.push(
                        Decoration.mark({
                            // No font-mono here: a second font's metrics would make the
                            // line taller than in view mode.
                            class: 'cm-formatting text-neutral-400 dark:text-neutral-500',
                        }).range(nodeFrom, nodeTo)
                    )
                    return
                }
                if (item.getChild('Task')) {
                    // Task items already show a checkbox; hide the marker and its space.
                    let markTo = nodeTo
                    const next = doc.sliceString(markTo, markTo + 1)
                    if (next === ' ' || next === '\t') markTo++
                    decorations.push(Decoration.replace({}).range(nodeFrom, markTo))
                    return
                }
                let depth = 0
                for (let p: SyntaxNode | null = list; p; p = p.parent) {
                    if (p.name === 'BulletList' || p.name === 'OrderedList') depth++
                }
                decorations.push(
                    Decoration.replace({ widget: new BulletWidget(depth) }).range(nodeFrom, nodeTo)
                )
                return
            }

            // 10. Blockquote
            if (name === 'Blockquote') {
                let depth = 1
                for (let p = node.node.parent; p; p = p.parent) {
                    if (p.name === 'Blockquote') depth++
                }
                const startLine = doc.lineAt(nodeFrom)
                const endLine = doc.lineAt(nodeTo)
                for (let l = startLine.number; l <= endLine.number; l++) {
                    const lineFrom = doc.line(l).from
                    if ((blockquoteDepth.get(lineFrom) ?? 0) < depth) {
                        blockquoteDepth.set(lineFrom, depth)
                    }
                }
                // No `return false`: children (QuoteMark, nested Blockquote, inline
                // formatting) still need to be visited.
                return
            }

            // 10b. Blockquote marker (each `>`): hidden together with its following
            // space when the cursor is off the line, shown dimmed when it is on it.
            if (name === 'QuoteMark') {
                const line = doc.lineAt(nodeFrom)
                const isLineActive = selFrom <= line.to && selTo >= line.from
                interactiveRanges.push({ from: line.from, to: line.to })
                let markTo = nodeTo
                const next = doc.sliceString(markTo, markTo + 1)
                if (next === ' ' || next === '\t') markTo++
                if (!isLineActive) {
                    decorations.push(Decoration.replace({}).range(nodeFrom, markTo))
                } else {
                    decorations.push(
                        Decoration.mark({
                            class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono not-italic',
                        }).range(nodeFrom, nodeTo)
                    )
                }
                return
            }

            // 11. Fenced Code Block
            if (name === 'FencedCode') {
                const startLine = doc.lineAt(nodeFrom)
                const endLine = doc.lineAt(nodeTo)

                // Check if multiline with closing fence
                const endMatch = endLine.text.match(/^(\s*)(`{3,}|~{3,})/)
                const hasClosingFence =
                    endLine.number > startLine.number && Boolean(endMatch)

                // The entire block is in Code Mode if unclosed or if cursor/selection intersects ANYWHERE inside this block
                const isBlockActive =
                    !hasClosingFence ||
                    state.selection.ranges.some(
                        (r) => r.from <= endLine.to && r.to >= startLine.from
                    )
                codeRanges.push({ from: startLine.from, to: endLine.to })
                interactiveRanges.push({ from: startLine.from, to: endLine.to })

                // Extract language and fence marks from start line
                const fenceMatch = startLine.text.match(
                    /^(\s*)(`{3,}|~{3,})\s*([a-zA-Z0-9_+#.-]*)/
                )
                const lang = fenceMatch && fenceMatch[3] ? fenceMatch[3] : ''

                // Extract code content for copy button
                let codeContent = ''
                if (hasClosingFence) {
                    if (endLine.number > startLine.number + 1) {
                        const codeFrom = doc.line(startLine.number + 1).from
                        const codeTo = doc.line(endLine.number - 1).to
                        codeContent = doc.sliceString(codeFrom, codeTo)
                    }
                } else {
                    if (endLine.number > startLine.number) {
                        const codeFrom = doc.line(startLine.number + 1).from
                        const codeTo = endLine.to
                        codeContent = doc.sliceString(codeFrom, codeTo)
                    }
                }

                // 1. Start line decoration & content
                if (!visitedCodeblockLines.has(startLine.from)) {
                    visitedCodeblockLines.add(startLine.from)

                    // The fence line keeps the same line decoration in both modes so the
                    // block's height does not change when the cursor enters or leaves it;
                    // only the line's content is swapped for the header widget.
                    decorations.push(
                        Decoration.line({
                            class: codeblockLineClass(
                                true,
                                startLine.number === endLine.number,
                                false
                            ),
                        }).range(startLine.from)
                    )
                    if (!isBlockActive) {
                        // Inline (not block) replacement: a block widget would substitute
                        // the whole line box with the widget's own, differently sized box.
                        decorations.push(
                            Decoration.replace({
                                widget: new CodeBlockHeaderWidget(lang, codeContent, startLine.from),
                            }).range(startLine.from, startLine.to)
                        )
                    } else {
                        if (fenceMatch) {
                            const indentLen = fenceMatch[1].length
                            const fenceMarkLen = fenceMatch[2].length
                            decorations.push(
                                Decoration.mark({
                                    class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-[0.75em] select-none',
                                }).range(
                                    startLine.from + indentLen,
                                    startLine.from + indentLen + fenceMarkLen
                                )
                            )
                            if (fenceMatch[3]) {
                                const langStart = startLine.text.indexOf(
                                    fenceMatch[3],
                                    indentLen + fenceMarkLen
                                )
                                if (langStart !== -1) {
                                    decorations.push(
                                        Decoration.mark({
                                            class: 'cm-formatting text-purple-600 dark:text-purple-400 font-mono text-[0.75em] font-semibold',
                                        }).range(
                                            startLine.from + langStart,
                                            startLine.from + langStart + fenceMatch[3].length
                                        )
                                    )
                                }
                            }
                        }
                    }
                }

                // 2. Intermediate code lines
                const lastCodeLineNum = hasClosingFence ? endLine.number - 1 : endLine.number
                for (let l = startLine.number + 1; l <= lastCodeLineNum; l++) {
                    const curLine = doc.line(l)
                    if (!visitedCodeblockLines.has(curLine.from)) {
                        visitedCodeblockLines.add(curLine.from)
                        decorations.push(
                            Decoration.line({
                                class: codeblockLineClass(
                                    false,
                                    !hasClosingFence && l === endLine.number,
                                    false
                                ),
                            }).range(curLine.from)
                        )
                    }
                }

                // 3. End line (closing fence)
                if (hasClosingFence && !visitedCodeblockLines.has(endLine.from)) {
                    visitedCodeblockLines.add(endLine.from)

                    // Same line box in both modes (see the start line above); in view mode
                    // the closing fence text is hidden, leaving an empty full-height line.
                    decorations.push(
                        Decoration.line({
                            class: codeblockLineClass(false, true, !isBlockActive),
                        }).range(endLine.from)
                    )
                    if (!isBlockActive) {
                        decorations.push(
                            Decoration.replace({}).range(endLine.from, endLine.to)
                        )
                    } else {
                        if (endMatch) {
                            const indentLen = endMatch[1].length
                            const fenceMarkLen = endMatch[2].length
                            decorations.push(
                                Decoration.mark({
                                    class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-[0.75em] select-none',
                                }).range(
                                    endLine.from + indentLen,
                                    endLine.from + indentLen + fenceMarkLen
                                )
                            )
                        }
                    }
                }

                return false
            }
        },
    })

    // 12. WikiLinks [[Note Name]]
    const fullText = doc.toString()
    const wikiRegex = /\[\[([^\]]+)\]\]/g
    let wikiMatch: RegExpExecArray | null
    while ((wikiMatch = wikiRegex.exec(fullText)) !== null) {
        const matchFrom = wikiMatch.index
        const matchTo = matchFrom + wikiMatch[0].length
        // Skip "[[...]]" examples that appear inside inline code or fenced code blocks;
        // those are literal text, not WikiLinks.
        if (rangesOverlap(codeRanges, matchFrom, matchTo)) continue
        if (rangesOverlap(renderedTableRanges, matchFrom, matchTo)) continue
        interactiveRanges.push({ from: matchFrom, to: matchTo })
        const isCursorInside = selFrom <= matchTo && selTo >= matchFrom
        // Editor's Ctrl+Click handler reads the raw link text from data-wiki-target.
        const missing = isMissingLink(wikiMatch[1])
        const wikiAttrs = {
            'data-wiki-target': wikiMatch[1],
            title: translate(missing ? 'wikiLinkMissingTitle' : 'wikiLinkTitle'),
        }
        if (!isCursorInside) {
            // With an alias ([[Note|Alias]]) only the alias stays visible.
            const pipe = wikiMatch[1].indexOf('|')
            const labelFrom = pipe >= 0 && wikiMatch[1].slice(pipe + 1).trim() ? matchFrom + 2 + pipe + 1 : matchFrom + 2
            decorations.push(
                Decoration.replace({}).range(matchFrom, labelFrom)
            )
            decorations.push(
                Decoration.mark({
                    class: missing ? WIKILINK_MISSING_CLASS : WIKILINK_CLASS + ' hover:underline',
                    attributes: wikiAttrs,
                }).range(labelFrom, matchTo - 2)
            )
            decorations.push(
                Decoration.replace({}).range(matchTo - 2, matchTo)
            )
        } else {
            decorations.push(
                Decoration.mark({
                    class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-[0.75em]',
                }).range(matchFrom, matchFrom + 2)
            )
            decorations.push(
                Decoration.mark({
                    class: missing
                        ? 'cm-wikilink cm-wikilink-missing text-purple-500/70 dark:text-purple-400/60 font-medium'
                        : 'cm-wikilink text-purple-600 dark:text-purple-400 font-medium',
                    attributes: wikiAttrs,
                }).range(matchFrom + 2, matchTo - 2)
            )
            decorations.push(
                Decoration.mark({
                    class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-[0.75em]',
                }).range(matchTo - 2, matchTo)
            )
        }
    }

    // Blockquote lines: one vertical bar per nesting level (drawn in CSS from --bq-depth).
    // The line box is identical whether or not the `>` markers are revealed, so moving the
    // cursor into a quote does not shift the layout.
    for (const [lineFrom, depth] of blockquoteDepth) {
        decorations.push(
            Decoration.line({
                class: `cm-blockquote cm-blockquote-depth-${depth} italic text-neutral-600 dark:text-neutral-400`,
                attributes: { style: `--bq-depth: ${depth}` },
            }).range(lineFrom)
        )
    }

    return {
        decorations: Decoration.set(decorations, true),
        interactiveRanges,
    }
}

// Test-only seam: exposes buildDecorations behind a small plugin-shaped wrapper so
// test-live-preview.mjs can exercise the real decoration logic without depending on
// the StateField/view machinery (see test harness for usage).
export class LivePreviewPlugin {
    decorations: DecorationSet

    constructor(view: { state: EditorState }) {
        this.decorations = buildDecorations(view.state).decorations
    }
}

// Caches the selection-sensitive ranges alongside the computed decorations so that a
// selection-only transaction can cheaply tell whether anything it affects actually
// changed (see livePreview.update below).
interface LivePreviewState {
    decorations: DecorationSet
    interactiveRanges: InteractiveRange[]
    selFrom: number
    selTo: number
}

function buildState(state: EditorState): LivePreviewState {
    const { decorations, interactiveRanges } = buildDecorations(state)
    const sel = state.selection.main
    return { decorations, interactiveRanges, selFrom: sel.from, selTo: sel.to }
}

export const livePreview = StateField.define<LivePreviewState>({
    create(state) {
        return buildState(state)
    },
    update(value, tr) {
        if (tr.docChanged || tr.effects.some((e) => e.is(setNotePaths))) {
            return buildState(tr.state)
        }
        if (tr.selection) {
            const sel = tr.state.selection.main
            // If neither the old nor the new selection touches any node whose rendering
            // depends on cursor position, the decoration set is unchanged: skip the full
            // document rebuild entirely instead of recomputing it on every cursor move.
            const touchedBefore = rangesOverlap(value.interactiveRanges, value.selFrom, value.selTo)
            const touchedAfter = rangesOverlap(value.interactiveRanges, sel.from, sel.to)
            if (!touchedBefore && !touchedAfter) {
                return { ...value, selFrom: sel.from, selTo: sel.to }
            }
            return buildState(tr.state)
        }
        return { ...value, decorations: value.decorations.map(tr.changes) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
})

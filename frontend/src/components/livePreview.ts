import {
    Decoration,
    DecorationSet,
    EditorView,
    WidgetType,
} from '@codemirror/view'
import { EditorState, Facet, Range, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { ReadAttachmentDataURL } from '../../wailsjs/go/main/App'
import { translate } from '../i18n'

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
        input.addEventListener('click', (e) => {
            e.stopPropagation()
            const change = this.checked ? '[ ]' : '[x]'
            view.dispatch({
                changes: { from: this.pos, to: this.pos + 3, insert: change },
            })
        })
        wrap.appendChild(input)
        return wrap
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
        pending = ReadAttachmentDataURL(notePath, src).catch((err) => {
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
        const header = document.createElement('div')
        header.className =
            'cm-codeblock-header flex items-center justify-between w-full select-none py-[2px] px-2 border-b border-neutral-200/60 dark:border-neutral-700/40 rounded-t-md bg-neutral-100/70 dark:bg-neutral-800/50 text-neutral-400 dark:text-neutral-500 font-sans leading-none'

        // Language label badge
        const leftWrap = document.createElement('div')
        leftWrap.className = 'flex items-center gap-1.5 leading-none'

        if (this.lang) {
            const langBadge = document.createElement('span')
            langBadge.className =
                'font-mono text-[10px] font-medium tracking-wider uppercase text-neutral-400 dark:text-neutral-500 leading-none select-none'
            langBadge.textContent = this.lang
            leftWrap.appendChild(langBadge)
        }
        header.appendChild(leftWrap)

        // Copy button
        const copyBtn = document.createElement('button')
        copyBtn.type = 'button'
        copyBtn.className =
            'cm-codeblock-copy-btn flex items-center gap-1 px-1 py-[1px] rounded transition-colors duration-150 text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 cursor-pointer font-sans text-[10px] leading-none'
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

    const decorations: Range<Decoration>[] = []
    const interactiveRanges: InteractiveRange[] = []
    // Ranges recognized as "code" (inline code spans and fenced code blocks), used to
    // keep the raw-text WikiLink scan below from decorating "[[...]]" examples that
    // appear inside code rather than as actual prose links.
    const codeRanges: InteractiveRange[] = []
    const visitedHeadingLines = new Set<number>()
    const visitedBlockquoteLines = new Set<number>()
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
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-xs',
                            }).range(nodeFrom, nodeFrom + openLen)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-inline-code font-mono text-[0.875em] bg-neutral-100/50 dark:bg-neutral-800/50 text-red-500 dark:text-red-400',
                            }).range(nodeFrom + openLen, nodeTo - closeLen)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-xs',
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
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-xs',
                            }).range(nodeFrom, nodeFrom + 1)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'text-blue-600 dark:text-blue-400 underline underline-offset-2',
                            }).range(nodeFrom + 1, labelEnd)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-xs',
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
                                class: 'cm-formatting font-mono text-xs text-neutral-400 dark:text-neutral-500',
                            }).range(nodeFrom, nodeTo)
                        )
                    }
                }
                return
            }

            // 10. Blockquote
            if (name === 'Blockquote') {
                const startLine = doc.lineAt(nodeFrom)
                const endLine = doc.lineAt(nodeTo)
                for (let l = startLine.number; l <= endLine.number; l++) {
                    const curLine = doc.line(l)
                    if (!visitedBlockquoteLines.has(curLine.from)) {
                        visitedBlockquoteLines.add(curLine.from)
                        decorations.push(
                            Decoration.line({
                                class: 'cm-blockquote border-l-4 border-neutral-300 dark:border-neutral-700 pl-3 italic text-neutral-600 dark:text-neutral-400 my-1',
                            }).range(curLine.from)
                        )
                    }
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

                    if (!isBlockActive) {
                        decorations.push(
                            Decoration.replace({
                                widget: new CodeBlockHeaderWidget(lang, codeContent, startLine.from),
                                block: true,
                            }).range(startLine.from, startLine.to)
                        )
                    } else {
                        decorations.push(
                            Decoration.line({
                                class: `cm-codeblock-line cm-codeblock-first font-mono text-sm bg-neutral-100/70 dark:bg-neutral-800/50 py-0.5${
                                    startLine.number === endLine.number ? ' cm-codeblock-last' : ''
                                }`,
                            }).range(startLine.from)
                        )
                        if (fenceMatch) {
                            const indentLen = fenceMatch[1].length
                            const fenceMarkLen = fenceMatch[2].length
                            decorations.push(
                                Decoration.mark({
                                    class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-xs select-none',
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
                                            class: 'cm-formatting text-purple-600 dark:text-purple-400 font-mono text-xs font-semibold',
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
                                class: `cm-codeblock-line font-mono text-sm bg-neutral-100/70 dark:bg-neutral-800/50 py-0.5${
                                    !hasClosingFence && l === endLine.number ? ' cm-codeblock-last' : ''
                                }`,
                            }).range(curLine.from)
                        )
                    }
                }

                // 3. End line (closing fence)
                if (hasClosingFence && !visitedCodeblockLines.has(endLine.from)) {
                    visitedCodeblockLines.add(endLine.from)

                    if (!isBlockActive) {
                        decorations.push(
                            Decoration.line({
                                class: 'cm-codeblock-line cm-codeblock-last cm-codeblock-footer font-mono text-sm bg-neutral-100/70 dark:bg-neutral-800/50',
                            }).range(endLine.from)
                        )
                        decorations.push(
                            Decoration.replace({}).range(endLine.from, endLine.to)
                        )
                    } else {
                        decorations.push(
                            Decoration.line({
                                class: 'cm-codeblock-line cm-codeblock-last font-mono text-sm bg-neutral-100/70 dark:bg-neutral-800/50 py-0.5',
                            }).range(endLine.from)
                        )
                        if (endMatch) {
                            const indentLen = endMatch[1].length
                            const fenceMarkLen = endMatch[2].length
                            decorations.push(
                                Decoration.mark({
                                    class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-xs select-none',
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
        interactiveRanges.push({ from: matchFrom, to: matchTo })
        const isCursorInside = selFrom <= matchTo && selTo >= matchFrom
        if (!isCursorInside) {
            decorations.push(
                Decoration.replace({}).range(matchFrom, matchFrom + 2)
            )
            decorations.push(
                Decoration.mark({
                    class: 'cm-wikilink text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-0.5 rounded cursor-pointer font-medium hover:underline',
                }).range(matchFrom + 2, matchTo - 2)
            )
            decorations.push(
                Decoration.replace({}).range(matchTo - 2, matchTo)
            )
        } else {
            decorations.push(
                Decoration.mark({
                    class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-xs',
                }).range(matchFrom, matchFrom + 2)
            )
            decorations.push(
                Decoration.mark({
                    class: 'cm-wikilink text-purple-600 dark:text-purple-400 font-medium',
                }).range(matchFrom + 2, matchTo - 2)
            )
            decorations.push(
                Decoration.mark({
                    class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-xs',
                }).range(matchTo - 2, matchTo)
            )
        }
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
        if (tr.docChanged) {
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

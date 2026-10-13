import {
    Decoration,
    DecorationSet,
    EditorView,
    WidgetType,
} from '@codemirror/view'
import { EditorState, Range, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

class CheckboxWidget extends WidgetType {
    constructor(
        readonly checked: boolean,
        readonly pos: number
    ) {
        super()
    }

    eq(other: CheckboxWidget) {
        return this.checked === other.checked && this.pos === other.pos
    }

    toDOM(view: EditorView) {
        const wrap = document.createElement('span')
        wrap.className = 'cm-task-checkbox-wrap inline-flex items-center align-middle mr-1.5'
        const input = document.createElement('input')
        input.type = 'checkbox'
        input.checked = this.checked
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

class ImageWidget extends WidgetType {
    constructor(
        readonly src: string,
        readonly alt: string
    ) {
        super()
    }

    eq(other: ImageWidget) {
        return this.src === other.src && this.alt === other.alt
    }

    toDOM() {
        // Padding rather than margin: see HrWidget for why block-decoration widgets must
        // confine their own height to padding/border instead of (uncounted) margins.
        const wrap = document.createElement('div')
        wrap.className = 'cm-image-widget py-2 block'
        const img = document.createElement('img')
        img.src = this.src
        img.alt = this.alt
        img.className =
            'max-w-full max-h-[450px] rounded-md border border-neutral-200 dark:border-neutral-700/60 shadow-sm object-contain'
        img.loading = 'lazy'
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
        copyBtn.title = 'Copy code'

        copyBtn.innerHTML = `
            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
            </svg>
            <span class="cm-copy-text leading-none">Copy</span>
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
                    <span class="cm-copy-text leading-none">Copied!</span>
                `
                if (copyTimeout) clearTimeout(copyTimeout)
                copyTimeout = setTimeout(() => {
                    copyBtn.classList.remove('text-emerald-600', 'dark:text-emerald-400')
                    copyBtn.innerHTML = `
                        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                        </svg>
                        <span class="cm-copy-text leading-none">Copy</span>
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

// Decorations are computed in a StateField (rather than a ViewPlugin) because several of
// them (horizontal rules, standalone images, fenced-code headers) are block-level widgets
// that replace an entire line. CodeMirror throws a RangeError ("Block decorations may not
// be specified via plugins") for `block: true` decorations supplied by a ViewPlugin, and
// treating them as inline instead desyncs the view's line-height/position model from the
// actual rendered DOM -- which is what caused clicks and Up/Down navigation to land on the
// wrong line. A StateField has no `view.visibleRanges` to limit scanning to, so decorations
// are built for the whole document; this is fine for note-sized Markdown files.
function buildDecorations(state: EditorState): DecorationSet {
    const doc = state.doc
    const selection = state.selection.main
    const selFrom = selection.from
    const selTo = selection.to

    const decorations: Range<Decoration>[] = []
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

            // 5. Inline Code (`code`)
            if (name === 'InlineCode') {
                if (nodeTo - nodeFrom >= 2) {
                    const isCursorInside = selFrom <= nodeTo && selTo >= nodeFrom
                    if (!isCursorInside) {
                        decorations.push(
                            Decoration.replace({}).range(nodeFrom, nodeFrom + 1)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-inline-code font-mono text-[0.875em] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-red-500 dark:text-red-400 border border-neutral-200 dark:border-neutral-700/60',
                            }).range(nodeFrom + 1, nodeTo - 1)
                        )
                        decorations.push(
                            Decoration.replace({}).range(nodeTo - 1, nodeTo)
                        )
                    } else {
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-xs',
                            }).range(nodeFrom, nodeFrom + 1)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-inline-code font-mono text-[0.875em] bg-neutral-100/50 dark:bg-neutral-800/50 text-red-500 dark:text-red-400',
                            }).range(nodeFrom + 1, nodeTo - 1)
                        )
                        decorations.push(
                            Decoration.mark({
                                class: 'cm-formatting text-neutral-400 dark:text-neutral-500 font-mono text-xs',
                            }).range(nodeTo - 1, nodeTo)
                        )
                    }
                }
                return
            }

            // 6. Horizontal Rule (--- or ***)
            if (name === 'HorizontalRule') {
                const line = doc.lineAt(nodeFrom)
                const isLineActive = selFrom <= line.to && selTo >= line.from
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
                    if (!isCursorOnMarker) {
                        const text = doc.sliceString(nodeFrom, nodeTo)
                        const isChecked = text.toLowerCase() === '[x]'
                        decorations.push(
                            Decoration.replace({
                                widget: new CheckboxWidget(isChecked, nodeFrom),
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
                    if (!isCursorInside) {
                        // An image that is the sole content of its line is rendered as a
                        // block widget (it visually occupies the whole line anyway); an
                        // image inline with surrounding text stays an inline widget.
                        const line = doc.lineAt(nodeFrom)
                        const isStandalone = line.text.trim() === imgStr
                        decorations.push(
                            Decoration.replace({
                                widget: new ImageWidget(src, alt),
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

    return Decoration.set(decorations, true)
}

export const livePreview = StateField.define<DecorationSet>({
    create(state) {
        return buildDecorations(state)
    },
    update(value, tr) {
        if (tr.docChanged || tr.selection) {
            return buildDecorations(tr.state)
        }
        return value.map(tr.changes)
    },
    provide: (f) => EditorView.decorations.from(f),
})

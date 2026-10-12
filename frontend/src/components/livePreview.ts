import {
    Decoration,
    DecorationSet,
    EditorView,
    ViewPlugin,
    ViewUpdate,
    WidgetType,
} from '@codemirror/view'
import { Range } from '@codemirror/state'
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
        const hr = document.createElement('div')
        hr.className = 'cm-hr-widget my-3 h-px bg-neutral-200 dark:bg-neutral-800 w-full'
        return hr
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
        const wrap = document.createElement('div')
        wrap.className = 'cm-image-widget my-2 block'
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

export class LivePreviewPlugin {
    decorations: DecorationSet

    constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view)
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view)
        }
    }

    buildDecorations(view: EditorView): DecorationSet {
        const doc = view.state.doc
        const selection = view.state.selection.main
        const selFrom = selection.from
        const selTo = selection.to

        const decorations: Range<Decoration>[] = []
        const visitedHeadingLines = new Set<number>()
        const visitedBlockquoteLines = new Set<number>()
        const visitedCodeblockLines = new Set<number>()

        const tree = syntaxTree(view.state)

        for (const range of view.visibleRanges) {
            tree.iterate({
                from: range.from,
                to: range.to,
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
                                }).range(nodeFrom, nodeTo)
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
                                decorations.push(
                                    Decoration.replace({
                                        widget: new ImageWidget(src, alt),
                                    }).range(nodeFrom, nodeTo)
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
                        for (let l = startLine.number; l <= endLine.number; l++) {
                            const curLine = doc.line(l)
                            if (!visitedCodeblockLines.has(curLine.from)) {
                                visitedCodeblockLines.add(curLine.from)
                                decorations.push(
                                    Decoration.line({
                                        class: 'cm-codeblock-line font-mono text-sm bg-neutral-100/70 dark:bg-neutral-800/50',
                                    }).range(curLine.from)
                                )
                            }
                        }
                        return
                    }
                },
            })

            // 12. WikiLinks [[Note Name]]
            const chunkText = doc.sliceString(range.from, range.to)
            const wikiRegex = /\[\[([^\]]+)\]\]/g
            let wikiMatch: RegExpExecArray | null
            while ((wikiMatch = wikiRegex.exec(chunkText)) !== null) {
                const matchFrom = range.from + wikiMatch.index
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
        }

        return Decoration.set(decorations, true)
    }
}

export const livePreview = ViewPlugin.fromClass(LivePreviewPlugin, {
    decorations: (v) => v.decorations,
})

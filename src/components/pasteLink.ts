import {EditorSelection, type EditorState, type TransactionSpec} from '@codemirror/state'
import {EditorView} from '@codemirror/view'
import {syntaxTree} from '@codemirror/language'
import type {SyntaxNode} from '@lezer/common'

// Pasting a URL while text is selected turns the selection into a Markdown link:
// "docs" + paste "https://x.y" → "[docs](https://x.y)". One transaction, so a single
// Ctrl+Z brings back the plain selected text.

const URL_RE = /^(?:https?:\/\/[^\s<>]+|mailto:[^\s<>@]+@[^\s<>]+)$/i

/** The pasted text as a URL, or null when it is not exactly one URL. */
export function pastedUrl(text: string): string | null {
    const t = text.trim()
    return URL_RE.test(t) ? t : null
}

// Syntax nodes inside which a paste must stay literal.
const CODE_NODES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText', 'URL', 'Autolink'])

function inCode(state: EditorState, from: number, to: number): boolean {
    const tree = syntaxTree(state)
    // Look at both ends, from inside the selection.
    for (const [pos, side] of [[from, 1], [to, -1]] as const) {
        for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) {
            if (CODE_NODES.has(n.name)) return true
        }
    }
    return false
}

/** Link text with "[" / "]" escaped so the link syntax stays intact. */
export function escapeLinkText(text: string): string {
    return text.replace(/([[\]\\])/g, '\\$1')
}

/** Destination, wrapped in <...> when parentheses would end it early. */
export function linkDestination(url: string): string {
    return /[()]/.test(url) ? `<${url}>` : url
}

/**
 * The change for pasting `text`, or null to let the normal paste run. Applies when every
 * selection range is non-empty, single-line, not itself a URL and not inside code.
 */
export function pasteAsLink(state: EditorState, text: string): TransactionSpec | null {
    const url = pastedUrl(text)
    if (!url) return null
    const ranges = state.selection.ranges
    if (ranges.some((r) => r.empty)) return null
    for (const r of ranges) {
        const selected = state.sliceDoc(r.from, r.to)
        if (selected.includes('\n') || pastedUrl(selected) || inCode(state, r.from, r.to)) return null
    }
    return {
        ...state.changeByRange((r) => {
            const insert = `[${escapeLinkText(state.sliceDoc(r.from, r.to))}](${linkDestination(url)})`
            return {changes: {from: r.from, to: r.to, insert}, range: EditorSelection.cursor(r.from + insert.length)}
        }),
        userEvent: 'input.paste',
        scrollIntoView: true,
    }
}

export const pasteUrlAsLink = EditorView.domEventHandlers({
    paste(event, view) {
        const data = event.clipboardData
        // Images are handled by Editor's attachment paste.
        if (!data || data.files.length > 0) return false
        const spec = pasteAsLink(view.state, data.getData('text/plain'))
        if (!spec) return false
        event.preventDefault()
        view.dispatch(spec)
        return true
    },
})

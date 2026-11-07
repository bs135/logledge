import {EditorState, Prec} from '@codemirror/state'
import {EditorView, keymap} from '@codemirror/view'
import {isolateHistory} from '@codemirror/commands'
import {syntaxTree} from '@codemirror/language'
import type {SyntaxNode} from '@lezer/common'

// Text emoticons converted to emoji once a space or Enter is typed after them.
export const EMOTICONS: Record<string, string> = {
    ':)': '🙂',
    ':-)': '🙂',
    ':(': '🙁',
    ':-(': '🙁',
    ':D': '😃',
    ':-D': '😃',
    ';)': '😉',
    ';-)': '😉',
    ':P': '😛',
    ':-P': '😛',
    ':p': '😛',
    ':-p': '😛',
    ':O': '😮',
    ':-O': '😮',
    ':o': '😮',
    ':-o': '😮',
    ':|': '😐',
    ':-|': '😐',
    ':/': '😕',
    ':-/': '😕',
    ':*': '😘',
    ':-*': '😘',
    ":'(": '😢',
    'XD': '😆',
    'xD': '😆',
    '^^': '😊',
    '^_^': '😊',
    '<3': '❤️',
    '</3': '💔',
}

const MAX_LEN = Math.max(...Object.keys(EMOTICONS).map((k) => k.length))

// Syntax nodes whose content must stay literal (code, URLs, raw HTML).
const LITERAL_NODES = new Set([
    'InlineCode',
    'FencedCode',
    'CodeBlock',
    'CodeText',
    'HTMLBlock',
    'HTMLTag',
    'Comment',
    'URL',
    'Autolink',
])

function inLiteralNode(state: EditorState, pos: number): boolean {
    for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
        if (LITERAL_NODES.has(node.name)) return true
    }
    return false
}

/**
 * Returns the change that turns the emoticon ending at `pos` into an emoji, or null.
 * The emoticon must stand alone: start of line or whitespace before it, so text such as
 * `http://` or `f(x)` is never touched.
 */
export function emoticonAt(state: EditorState, pos: number): {from: number; to: number; insert: string} | null {
    const line = state.doc.lineAt(pos)
    const before = state.sliceDoc(Math.max(line.from, pos - MAX_LEN - 1), pos)
    // Try the longest match first so `:-)` wins over `-)`-like suffixes.
    for (let len = Math.min(MAX_LEN, before.length); len >= 2; len--) {
        const token = before.slice(before.length - len)
        const emoji = EMOTICONS[token]
        if (!emoji) continue
        const from = pos - len
        const prev = from > line.from ? state.sliceDoc(from - 1, from) : ''
        if (prev && !/\s/.test(prev)) continue
        if (inLiteralNode(state, pos)) return null
        return {from, to: pos, insert: emoji}
    }
    return null
}

// The conversion is its own undo step, so Ctrl+Z right after brings the emoticon text back.
function convertAt(view: EditorView, pos: number): boolean {
    const change = emoticonAt(view.state, pos)
    if (!change) return false
    view.dispatch({
        changes: change,
        userEvent: 'input.emoji',
        annotations: isolateHistory.of('full'),
    })
    return true
}

export const emoticonToEmoji = [
    EditorView.inputHandler.of((view, from, to, text) => {
        if (view.composing || text !== ' ' || from !== to) return false
        if (view.state.selection.ranges.length !== 1) return false
        if (!emoticonAt(view.state, from)) return false
        // Insert the space as normal typing first, then convert, so undo keeps the space.
        view.dispatch({
            changes: {from, insert: text},
            selection: {anchor: from + 1},
            userEvent: 'input.type',
        })
        convertAt(view, from)
        return true
    }),
    // Highest precedence so it runs before the Markdown Enter handler; returning false
    // lets the regular newline (with list continuation) happen afterwards.
    Prec.highest(
        keymap.of([
            {
                key: 'Enter',
                run: (view) => {
                    const sel = view.state.selection
                    if (sel.ranges.length !== 1 || !sel.main.empty) return false
                    convertAt(view, sel.main.head)
                    return false
                },
            },
        ]),
    ),
]

import type {EditorState, TransactionSpec} from '@codemirror/state'

// Runs of the marker char longer than this are not treated as formatting (e.g. `****`).
const MAX_RUN = 3

function runBefore(state: EditorState, pos: number, ch: string): number {
    let n = 0
    while (n < MAX_RUN + 1 && pos - n - 1 >= 0 && state.sliceDoc(pos - n - 1, pos - n) === ch) n++
    return n
}

function runAfter(state: EditorState, pos: number, ch: string): number {
    const len = state.doc.length
    let n = 0
    while (n < MAX_RUN + 1 && pos + n < len && state.sliceDoc(pos + n, pos + n + 1) === ch) n++
    return n
}

function leadingRun(text: string, ch: string): number {
    let n = 0
    while (n < text.length && text[n] === ch) n++
    return n
}

function trailingRun(text: string, ch: string): number {
    let n = 0
    while (n < text.length && text[text.length - 1 - n] === ch) n++
    return n
}

/**
 * Decides whether a marker of `size` chars is present given the run lengths of the
 * marker char on each side. A single char (`*`) and its double (`**`) share one char,
 * so `***x***` is both bold and italic, `**x**` is bold only and `*x*` is italic only.
 */
function hasMarker(left: number, right: number, size: number, sameCharDouble: boolean): boolean {
    if (left > MAX_RUN || right > MAX_RUN) return false
    if (left < size || right < size) return false
    if (!sameCharDouble) return true
    // Single-char marker that also has a double form: present only on odd runs (1 or 3).
    if (size === 1) return left % 2 === 1 && right % 2 === 1
    return true
}

/**
 * Builds the transaction that toggles an inline Markdown marker (e.g. `**`, `*`, `~~`)
 * around the main selection. The marker is removed when it already surrounds the
 * selection, either just outside it (the state right after wrapping) or as part of the
 * selected text; otherwise the selection is wrapped.
 */
export function toggleInlineMarker(state: EditorState, marker: string): TransactionSpec {
    const ch = marker[0]
    const size = marker.length
    // `*` and `_` combine with their doubled form for bold-italic; `~~` does not.
    const sameCharDouble = size === 1 && (ch === '*' || ch === '_')
    const {from, to} = state.selection.main

    // 1. Marker right outside the selection: `**|text|**`.
    const left = runBefore(state, from, ch)
    const right = runAfter(state, to, ch)
    if (hasMarker(left, right, size, sameCharDouble)) {
        return {
            changes: [
                {from: from - size, to: from},
                {from: to, to: to + size},
            ],
            selection: {anchor: from - size, head: to - size},
        }
    }

    // 2. Marker inside the selection: `|**text**|`.
    const text = state.sliceDoc(from, to)
    const innerLeft = leadingRun(text, ch)
    const innerRight = trailingRun(text, ch)
    if (innerLeft < text.length && hasMarker(innerLeft, innerRight, size, sameCharDouble)) {
        return {
            changes: [
                {from, to: from + size},
                {from: to - size, to},
            ],
            selection: {anchor: from, head: to - 2 * size},
        }
    }

    // 3. Wrap.
    return {
        changes: [
            {from, insert: marker},
            {from: to, insert: marker},
        ],
        selection: {anchor: from + size, head: to + size},
    }
}

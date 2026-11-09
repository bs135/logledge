import type {Completion, CompletionContext, CompletionResult, CompletionSource} from '@codemirror/autocomplete'
import type {EditorView} from '@codemirror/view'
import {notePathFacet, notePathsField} from './livePreview'
import {extractHeadings, noteCompletionEntries, resolveWikiLink, wikiCompletionContext} from '../lib/wikilink'

// Matches what may still be typed without leaving the completed part of the link, so
// CodeMirror can keep filtering the same result list instead of asking again.
const NOTE_VALID_FOR = /^[^[\]|#]*$/
const HEADING_VALID_FOR = /^[^[\]|]*$/

// Inserts `text` over [from, to) and closes the link: "]]" is added unless it already
// follows the cursor (when editing an existing link), and the cursor ends after it.
function applyAndClose(text: string) {
    return (view: EditorView, _completion: Completion, from: number, to: number) => {
        const hasClose = view.state.sliceDoc(to, to + 2) === ']]'
        const insert = hasClose ? text : text + ']]'
        view.dispatch({
            changes: {from, to, insert},
            selection: {anchor: from + text.length + 2},
            userEvent: 'input.complete',
        })
    }
}

/**
 * Completion for WikiLinks: note names after "[[", headings after "[[Note#" (or "[[#"
 * for the current note). Notes come from notePathsField; `readNote` loads another note's
 * text to list its headings.
 */
export function wikiLinkCompletion(readNote: (path: string) => Promise<string>): CompletionSource {
    return async (context: CompletionContext): Promise<CompletionResult | null> => {
        const line = context.state.doc.lineAt(context.pos)
        const ctx = wikiCompletionContext(line.text.slice(0, context.pos - line.from))
        if (!ctx) return null
        const from = line.from + ctx.offset
        const paths = context.state.field(notePathsField, false)
        if (!paths) return null
        const currentPath = context.state.facet(notePathFacet) || null

        if (ctx.kind === 'note') {
            const currentDir = currentPath && currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : ''
            const options: Completion[] = noteCompletionEntries(paths)
                .filter((e) => e.path !== currentPath)
                .map((e) => ({
                    label: e.label,
                    detail: e.folder,
                    type: 'wikilink',
                    // Notes next to the current one first among equally good matches.
                    boost: e.folder === currentDir ? 1 : 0,
                    apply: applyAndClose(e.label),
                }))
            return {from, options, validFor: NOTE_VALID_FOR}
        }

        let text: string
        if (!ctx.target) {
            text = context.state.doc.toString()
        } else {
            const path = resolveWikiLink(ctx.target, paths, currentPath)
            if (!path) return null
            try {
                text = await readNote(path)
            } catch {
                return null
            }
            if (context.aborted) return null
        }
        const options: Completion[] = extractHeadings(text).map((h, i) => ({
            label: h.text,
            detail: 'H' + h.level,
            type: 'wikilink-heading',
            // Keep document order when nothing has been typed yet.
            boost: -i / 1000,
            apply: applyAndClose(h.text),
        }))
        return {from, options, validFor: HEADING_VALID_FOR}
    }
}

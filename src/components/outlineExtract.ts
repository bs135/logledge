import type {EditorState} from '@codemirror/state'
import {ensureSyntaxTree, syntaxTree} from '@codemirror/language'
import {plainHeadingText, type OutlineItem} from '../lib/outline'

// Parsing a long note to the end can take a moment; give up after this many ms and use
// whatever part of the tree is ready (the outline fills in on the next update).
const PARSE_BUDGET_MS = 50

/** Headings of the note, from the Markdown syntax tree (ATX and setext; code is skipped by the parser). */
export function outlineFromState(state: EditorState): OutlineItem[] {
    const tree = ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state)
    const items: OutlineItem[] = []
    tree.iterate({
        enter(node) {
            const atx = /^ATXHeading([1-6])$/.exec(node.name)
            const setext = /^SetextHeading([12])$/.exec(node.name)
            if (!atx && !setext) return
            const level = Number((atx ?? setext)![1])
            // Text without the heading markers ("#", closing "#", or the "===" underline).
            let text = state.sliceDoc(node.from, node.to)
            if (atx) {
                text = text.replace(/^ {0,3}#{1,6}(?=\s|$)/, '').replace(/\s+#+\s*$/, '')
            } else {
                text = text.split('\n')[0]
            }
            const plain = plainHeadingText(text)
            if (plain) items.push({level, text: plain, from: node.from})
            return false
        },
    })
    return items
}

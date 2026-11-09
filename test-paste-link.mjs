import test from 'node:test'
import assert from 'node:assert'
import {createRequire} from 'node:module'
import esbuild from 'esbuild'

// The bundle loads the CommonJS builds of @codemirror/* via require, so the test builds its
// states from those same instances.
const require = createRequire(import.meta.url)
const result = esbuild.buildSync({
    entryPoints: ['src/components/pasteLink.ts'],
    bundle: true,
    format: 'cjs',
    write: false,
    external: ['@codemirror/*', '@lezer/*'],
})
const mod = {exports: {}}
new Function('require', 'exports', 'module', result.outputFiles[0].text)(require, mod.exports, mod)
const {pastedUrl, escapeLinkText, linkDestination, pasteAsLink} = mod.exports
const {EditorState, EditorSelection} = require('@codemirror/state')
const {markdown, markdownLanguage} = require('@codemirror/lang-markdown')
const {ensureSyntaxTree} = require('@codemirror/language')

// `ranges` are [from, to] pairs.
function stateWith(doc, ranges) {
    const state = EditorState.create({
        doc,
        selection: EditorSelection.create(ranges.map(([a, b]) => EditorSelection.range(a, b))),
        extensions: [markdown({base: markdownLanguage}), EditorState.allowMultipleSelections.of(true)],
    })
    ensureSyntaxTree(state, doc.length, 5000)
    return state
}

function paste(doc, ranges, text) {
    const state = stateWith(doc, ranges)
    const spec = pasteAsLink(state, text)
    if (!spec) return null
    const next = state.update(spec).state
    return {doc: next.doc.toString(), cursor: next.selection.main.head}
}

const sel = (doc, word) => [doc.indexOf(word), doc.indexOf(word) + word.length]

test('pastedUrl: exactly one http(s) or mailto URL', () => {
    assert.strictEqual(pastedUrl('  https://example.com/a?b=1#c \n'), 'https://example.com/a?b=1#c')
    assert.strictEqual(pastedUrl('mailto:me@example.com'), 'mailto:me@example.com')
    assert.strictEqual(pastedUrl('see https://example.com'), null)
    assert.strictEqual(pastedUrl('https://a.b https://c.d'), null)
    assert.strictEqual(pastedUrl('example.com'), null)
    assert.strictEqual(pastedUrl('ftp://x.y'), null)
})

test('escapeLinkText and linkDestination keep the link syntax intact', () => {
    assert.strictEqual(escapeLinkText('a [b] c\\'), 'a \\[b\\] c\\\\')
    assert.strictEqual(linkDestination('https://x.y/a'), 'https://x.y/a')
    assert.strictEqual(linkDestination('https://en.wikipedia.org/wiki/Foo_(bar)'), '<https://en.wikipedia.org/wiki/Foo_(bar)>')
})

test('pasteAsLink: selection becomes [text](url), cursor after the link', () => {
    const doc = 'Read the docs today'
    const r = paste(doc, [sel(doc, 'the docs')], 'https://example.com')
    assert.strictEqual(r.doc, 'Read [the docs](https://example.com) today')
    assert.strictEqual(r.cursor, 'Read [the docs](https://example.com)'.length)
})

test('pasteAsLink: every selection range is linked', () => {
    const doc = 'one two'
    const r = paste(doc, [sel(doc, 'one'), sel(doc, 'two')], 'https://x.y')
    assert.strictEqual(r.doc, '[one](https://x.y) [two](https://x.y)')
})

test('pasteAsLink: normal paste when it does not apply', () => {
    const doc = 'Read the docs\nnext line'
    assert.strictEqual(paste(doc, [[5, 5]], 'https://x.y'), null, 'no selection')
    assert.strictEqual(paste(doc, [sel(doc, 'docs')], 'not a url'), null, 'not a URL')
    assert.strictEqual(paste(doc, [[5, 18]], 'https://x.y'), null, 'multi-line selection')
    const urlDoc = 'old https://a.b link'
    assert.strictEqual(paste(urlDoc, [sel(urlDoc, 'https://a.b')], 'https://c.d'), null, 'replacing a URL with a URL')
})

test('pasteAsLink: not inside inline code or code blocks', () => {
    const inline = 'use `the docs` here'
    assert.strictEqual(paste(inline, [sel(inline, 'docs')], 'https://x.y'), null)
    const fenced = 'text\n\n```\nthe docs\n```\n'
    assert.strictEqual(paste(fenced, [sel(fenced, 'docs')], 'https://x.y'), null)
})

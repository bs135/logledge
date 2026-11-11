import test from 'node:test'
import assert from 'node:assert'
import {createRequire} from 'node:module'
import esbuild from 'esbuild'

// Bundle wikiComplete.ts together with the livePreview fields it reads, leaving
// @codemirror/* external and loading the CommonJS builds, so the test and the bundle
// share one instance of each CodeMirror package.
const require = createRequire(import.meta.url)
const all = (() => {
    const result = esbuild.buildSync({
        stdin: {
            contents: "export {wikiLinkCompletion} from './src/components/wikiComplete'; export {notePathFacet, notePathsField} from './src/components/livePreview'",
            resolveDir: '.',
            loader: 'ts',
        },
        bundle: true,
        format: 'cjs',
        write: false,
        external: ['@codemirror/*', '@lezer/*', '@tauri-apps/*'],
    })
    const mod = {exports: {}}
    new Function('require', 'exports', 'module', result.outputFiles[0].text)(require, mod.exports, mod)
    return mod.exports
})()
const {EditorState} = require('@codemirror/state')
const {CompletionContext} = require('@codemirror/autocomplete')

function stateFor(doc, paths, current = 'notes/current.md') {
    return EditorState.create({
        doc,
        selection: {anchor: doc.length},
        extensions: [all.notePathFacet.of(current), all.notePathsField.init(() => paths)],
    })
}

async function complete(doc, paths, notes = {}) {
    const state = stateFor(doc, paths)
    const source = all.wikiLinkCompletion(async (p) => {
        if (!(p in notes)) throw new Error('missing ' + p)
        return notes[p]
    })
    const result = await source(new CompletionContext(state, doc.length, false))
    return {state, result}
}

function applyOption(state, result, label) {
    const opt = result.options.find((o) => o.label === label)
    assert.ok(opt, `option ${label}`)
    let spec
    const view = {state, dispatch: (s) => (spec = s)}
    opt.apply(view, opt, result.from, state.doc.length)
    const next = state.update(spec).state
    return {text: next.doc.toString(), cursor: next.selection.main.head}
}

const PATHS = ['notes/current.md', 'notes/Roadmap.md', 'archive/Roadmap.md', 'Home.md', 'img/a.png']

test('note completion: lists notes except the current one, from right after "[["', async () => {
    const {result} = await complete('See [[Ro', PATHS)
    assert.strictEqual(result.from, 6)
    assert.deepStrictEqual(result.options.map((o) => o.label).sort(), ['Home', 'archive/Roadmap', 'notes/Roadmap'])
    const same = result.options.find((o) => o.label === 'notes/Roadmap')
    assert.strictEqual(same.boost, 1, 'note in the current folder is boosted')
})

test('note completion: accepting inserts the label and closes the link', async () => {
    const {state, result} = await complete('See [[Ro', PATHS)
    const r = applyOption(state, result, 'Home')
    assert.strictEqual(r.text, 'See [[Home]]')
    assert.strictEqual(r.cursor, r.text.length)
})

test('note completion: no completion outside "[[" or before the note list is known', async () => {
    assert.strictEqual((await complete('plain [text', PATHS)).result, null)
    const state = EditorState.create({doc: '[[x', selection: {anchor: 3}})
    const res = await all.wikiLinkCompletion(async () => '')(new CompletionContext(state, 3, false))
    assert.strictEqual(res, null)
})

test('heading completion: headings of the linked note, in document order', async () => {
    const {state, result} = await complete('[[Home#', PATHS, {'Home.md': '# Intro\ntext\n## Setup Guide\n'})
    assert.deepStrictEqual(result.options.map((o) => o.label), ['Intro', 'Setup Guide'])
    assert.deepStrictEqual(result.options.map((o) => o.detail), ['H1', 'H2'])
    assert.strictEqual(applyOption(state, result, 'Setup Guide').text, '[[Home#Setup Guide]]')
})

test('heading completion: "[[#" lists headings of the current note; unknown note gives none', async () => {
    const {result} = await complete('# Top\n## Sub\n[[#', PATHS)
    assert.deepStrictEqual(result.options.map((o) => o.label), ['Top', 'Sub'])
    assert.strictEqual((await complete('[[Nope#', PATHS)).result, null)
})

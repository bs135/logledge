import test from 'node:test'
import assert from 'node:assert'
import {createRequire} from 'node:module'
import esbuild from 'esbuild'
import {EditorState, EditorSelection} from '@codemirror/state'

const require = createRequire(import.meta.url)

const buildResult = esbuild.buildSync({
    entryPoints: ['src/components/formatting.ts'],
    bundle: true,
    format: 'cjs',
    write: false,
    external: ['@codemirror/*'],
})
const mod = {exports: {}}
new Function('require', 'exports', 'module', buildResult.outputFiles[0].text)(require, mod.exports, mod)
const {toggleInlineMarker} = mod.exports

// `[` and `]` mark the selection in the input/expected strings.
function parse(marked) {
    const from = marked.indexOf('[')
    const to = marked.indexOf(']') - 1
    return {doc: marked.replace('[', '').replace(']', ''), from, to}
}

function render(state) {
    const {from, to} = state.selection.main
    const doc = state.doc.toString()
    return doc.slice(0, from) + '[' + doc.slice(from, to) + ']' + doc.slice(to)
}

function toggle(marked, marker) {
    const {doc, from, to} = parse(marked)
    const state = EditorState.create({doc, selection: EditorSelection.single(from, to)})
    return render(state.update(toggleInlineMarker(state, marker)).state)
}

test('bold: wrap then toggle again unwraps', () => {
    const once = toggle('a [word] b', '**')
    assert.strictEqual(once, 'a **[word]** b')
    assert.strictEqual(toggle(once, '**'), 'a [word] b')
})

test('bold: unwraps when markers are selected too', () => {
    assert.strictEqual(toggle('a [**word**] b', '**'), 'a [word] b')
})

test('italic: wrap then toggle again unwraps', () => {
    const once = toggle('[word]', '*')
    assert.strictEqual(once, '*[word]*')
    assert.strictEqual(toggle(once, '*'), '[word]')
})

test('italic inside bold adds italic instead of eating a bold star', () => {
    assert.strictEqual(toggle('**[word]**', '*'), '***[word]***')
})

test('bold inside italic adds bold', () => {
    assert.strictEqual(toggle('*[word]*', '**'), '***[word]***')
})

test('bold-italic: remove each marker independently', () => {
    assert.strictEqual(toggle('***[word]***', '**'), '*[word]*')
    assert.strictEqual(toggle('***[word]***', '*'), '**[word]**')
})

test('empty selection: insert pair, toggle again removes it', () => {
    const once = toggle('a []b', '**')
    assert.strictEqual(once, 'a **[]**b')
    assert.strictEqual(toggle(once, '**'), 'a []b')
})

test('selection with only marker chars is wrapped, not unwrapped', () => {
    assert.strictEqual(toggle('[**]', '**'), '**[**]**')
})

test('inline code marker toggles', () => {
    const once = toggle('run [npm test] now', '`')
    assert.strictEqual(once, 'run `[npm test]` now')
    assert.strictEqual(toggle(once, '`'), 'run [npm test] now')
    assert.strictEqual(toggle('run [`npm test`] now', '`'), 'run [npm test] now')
})

test('strikethrough marker toggles', () => {
    const once = toggle('[x]', '~~')
    assert.strictEqual(once, '~~[x]~~')
    assert.strictEqual(toggle(once, '~~'), '[x]')
})

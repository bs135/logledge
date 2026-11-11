import test from 'node:test'
import assert from 'node:assert'
import {createRequire} from 'node:module'
import esbuild from 'esbuild'

// outlineExtract loads the CommonJS builds of @codemirror/* via require; the test builds
// its states from the same instances.
const require = createRequire(import.meta.url)
const result = esbuild.buildSync({
    stdin: {
        contents: "export * from './src/lib/outline'; export {outlineFromState} from './src/components/outlineExtract'",
        resolveDir: '.',
        loader: 'ts',
    },
    bundle: true,
    format: 'cjs',
    write: false,
    external: ['@codemirror/*', '@lezer/*'],
})
const mod = {exports: {}}
new Function('require', 'exports', 'module', result.outputFiles[0].text)(require, mod.exports, mod)
const {plainHeadingText, activeHeadingIndex, outlineIndents, outlineFromState} = mod.exports
const {EditorState} = require('@codemirror/state')
const {markdown, markdownLanguage} = require('@codemirror/lang-markdown')

const outline = (doc) => outlineFromState(EditorState.create({doc, extensions: [markdown({base: markdownLanguage})]}))

test('plainHeadingText: inline Markdown removed', () => {
    assert.strictEqual(plainHeadingText('**Setup** [[Guide|the guide]]'), 'Setup the guide')
    assert.strictEqual(plainHeadingText('Use `npm` and [docs](https://x.y)'), 'Use npm and docs')
    assert.strictEqual(plainHeadingText('*Em* and _em_ ~~old~~'), 'Em and em old')
    assert.strictEqual(plainHeadingText('[[README.md]]'), 'README.md')
    assert.strictEqual(plainHeadingText('C# \\[draft\\] snake_case_name'), 'C# [draft] snake_case_name')
})

test('outlineFromState: ATX and setext headings with levels and positions', () => {
    const doc = '# Title\n\ntext\n\n## Part *one* ##\n\nSub\n---\n\nTop two\n===\n'
    assert.deepStrictEqual(outline(doc), [
        {level: 1, text: 'Title', from: 0},
        {level: 2, text: 'Part one', from: doc.indexOf('## Part')},
        {level: 2, text: 'Sub', from: doc.indexOf('Sub')},
        {level: 1, text: 'Top two', from: doc.indexOf('Top two')},
    ])
})

test('outlineFromState: headings in code blocks and empty headings are skipped', () => {
    const doc = '# Real\n\n```\n# not a heading\n```\n\n#\n\n    # indented code\n'
    assert.deepStrictEqual(outline(doc).map((i) => i.text), ['Real'])
})

test('activeHeadingIndex: last heading at or before the position', () => {
    const items = [{from: 0}, {from: 10}, {from: 50}]
    assert.strictEqual(activeHeadingIndex(items, 0), 0)
    assert.strictEqual(activeHeadingIndex(items, 9), 0)
    assert.strictEqual(activeHeadingIndex(items, 10), 1)
    assert.strictEqual(activeHeadingIndex(items, 999), 2)
    assert.strictEqual(activeHeadingIndex([{from: 5}], 2), -1)
    assert.strictEqual(activeHeadingIndex([], 2), -1)
})

test('outlineIndents: relative to the shallowest level', () => {
    assert.deepStrictEqual(outlineIndents([{level: 2}, {level: 3}, {level: 2}, {level: 4}]), [0, 1, 0, 2])
    assert.deepStrictEqual(outlineIndents([]), [])
})

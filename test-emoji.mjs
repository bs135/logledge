import test from 'node:test'
import assert from 'node:assert'
import {createRequire} from 'node:module'
import esbuild from 'esbuild'
import {EditorState} from '@codemirror/state'
import {ensureSyntaxTree} from '@codemirror/language'
import {markdown, markdownLanguage} from '@codemirror/lang-markdown'
import {GFM} from '@lezer/markdown'

const require = createRequire(import.meta.url)

const buildResult = esbuild.buildSync({
    entryPoints: ['src/components/emoji.ts'],
    bundle: true,
    format: 'cjs',
    write: false,
    external: ['@codemirror/*', '@lezer/*'],
})
const mod = {exports: {}}
new Function('require', 'exports', 'module', buildResult.outputFiles[0].text)(require, mod.exports, mod)
const {emoticonAt} = mod.exports

// `|` marks the cursor; returns the doc after converting the emoticon before it (if any).
function convert(marked) {
    const pos = marked.indexOf('|')
    const doc = marked.replace('|', '')
    const state = EditorState.create({doc, extensions: [markdown({base: markdownLanguage, extensions: [GFM]})]})
    ensureSyntaxTree(state, state.doc.length, 5000)
    const change = emoticonAt(state, pos)
    return change ? state.update({changes: change}).state.doc.toString() : doc
}

test('converts common emoticons', () => {
    assert.strictEqual(convert(':)|'), '🙂')
    assert.strictEqual(convert('hi :-)|'), 'hi 🙂')
    assert.strictEqual(convert('so sad :(|'), 'so sad 🙁')
    assert.strictEqual(convert('lol :D|'), 'lol 😃')
    assert.strictEqual(convert('wink ;)|'), 'wink 😉')
    assert.strictEqual(convert("cry :'(|"), 'cry 😢')
    assert.strictEqual(convert('love <3|'), 'love ❤️')
    assert.strictEqual(convert('broken </3|'), 'broken 💔')
})

test('only converts text right before the cursor', () => {
    assert.strictEqual(convert(':)| tail'), '🙂 tail')
    assert.strictEqual(convert(':) |'), ':) ')
})

test('requires whitespace or line start before the emoticon', () => {
    assert.strictEqual(convert('http:/|'), 'http:/')
    assert.strictEqual(convert('f(x:)|'), 'f(x:)')
    assert.strictEqual(convert('a\n:)|'), 'a\n🙂')
})

test('works inside list items and headings', () => {
    assert.strictEqual(convert('- done :)|'), '- done 🙂')
    assert.strictEqual(convert('# Title :D|'), '# Title 😃')
})

test('leaves code untouched', () => {
    assert.strictEqual(convert('`a :)|`'), '`a :)`')
    assert.strictEqual(convert('```\n:)|\n```'), '```\n:)\n```')
    assert.strictEqual(convert('    :)|'), '    :)')
})

test('converts symbol shortcuts', () => {
    assert.strictEqual(convert('(c)|'), '©')
    assert.strictEqual(convert('Copyright (C)|'), 'Copyright ©')
    assert.strictEqual(convert('Brand (r)|'), 'Brand ®')
    assert.strictEqual(convert('Brand (R)|'), 'Brand ®')
    assert.strictEqual(convert('Logledge (tm)|'), 'Logledge ™')
    assert.strictEqual(convert('Logledge (TM)|'), 'Logledge ™')
    assert.strictEqual(convert('5 +-|'), '5 ±')
    assert.strictEqual(convert('+-|'), '±')
})

test('converts dashes only after text on the line', () => {
    assert.strictEqual(convert('pages 10 --|'), 'pages 10 –')
    assert.strictEqual(convert('wait ---|'), 'wait —')
    // Line-leading dashes are Markdown: horizontal rule, setext underline, front matter.
    assert.strictEqual(convert('---|'), '---')
    assert.strictEqual(convert('Title\n--|'), 'Title\n--')
    assert.strictEqual(convert('  ---|'), '  ---')
    // Table delimiter rows and CLI flags are left alone.
    // (`|` is the cursor marker in convert(), so the table case places the cursor at the end.)
    const tableDoc = '| a | b |\n| --- | ---'
    const tableState = EditorState.create({doc: tableDoc, extensions: [markdown({base: markdownLanguage, extensions: [GFM]})]})
    assert.strictEqual(emoticonAt(tableState, tableDoc.length), null)
    assert.strictEqual(convert('run --help|'), 'run --help')
    assert.strictEqual(convert('a--|'), 'a--')
})

test('requires whitespace or line start before a symbol shortcut', () => {
    assert.strictEqual(convert('f(c)|'), 'f(c)')
    assert.strictEqual(convert('x+-|'), 'x+-')
})

test('leaves symbol shortcuts in code untouched', () => {
    assert.strictEqual(convert('`a (c)|`'), '`a (c)`')
    assert.strictEqual(convert('```\nx --|\n```'), '```\nx --\n```')
})

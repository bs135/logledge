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

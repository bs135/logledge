import test from 'node:test'
import assert from 'node:assert'
import esbuild from 'esbuild'

const out = esbuild.buildSync({entryPoints: ['src/lib/textStats.ts'], bundle: true, format: 'cjs', write: false})
const mod = {exports: {}}
new Function('exports', 'module', out.outputFiles[0].text)(mod.exports, mod)
const {textStats, readingMinutes} = mod.exports

test('textStats: words ignore Markdown markers and link destinations', () => {
    assert.deepStrictEqual(textStats(''), {words: 0, chars: 0})
    assert.strictEqual(textStats('# Hello world').words, 2)
    assert.strictEqual(textStats('- [ ] **bold** and *it* | `code` > quote').words, 5)
    assert.strictEqual(textStats("don't stop real-time 2024").words, 4)
    assert.strictEqual(textStats('See [the docs](https://example.com/a-b/c) now').words, 4)
    assert.strictEqual(textStats('![alt text](img/pic.png "title")').words, 2)
    assert.strictEqual(textStats('[[Project Roadmap|plan]]').words, 3)
})

test('textStats: Vietnamese and other scripts count as words', () => {
    assert.strictEqual(textStats('Xin chào thế giới').words, 4)
    assert.strictEqual(textStats('Tiếng Việt có dấu: ở, ữ').words, 6)
})

test('textStats: characters exclude line breaks, emoji count once', () => {
    assert.strictEqual(textStats('ab\ncd\r\n').chars, 4)
    assert.strictEqual(textStats('hi 🙂').chars, 4)
    assert.strictEqual(textStats('Việt').chars, 4)
})

test('readingMinutes: 0 for empty, at least 1, rounded', () => {
    assert.strictEqual(readingMinutes(0), 0)
    assert.strictEqual(readingMinutes(5), 1)
    assert.strictEqual(readingMinutes(450), 2)
    assert.strictEqual(readingMinutes(1000), 5)
})

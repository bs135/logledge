import test from 'node:test'
import assert from 'node:assert'
import esbuild from 'esbuild'

const out = esbuild.buildSync({entryPoints: ['src/lib/grep.ts'], bundle: true, format: 'cjs', write: false})
const mod = {exports: {}}
new Function('exports', 'module', out.outputFiles[0].text)(mod.exports, mod)
const {lineParts, replaceTotals} = mod.exports

test('lineParts: plain and matched segments, in order', () => {
    assert.deepStrictEqual(lineParts('a foo b foo', [[8, 11], [2, 5]]), [
        {text: 'a ', match: false},
        {text: 'foo', match: true},
        {text: ' b ', match: false},
        {text: 'foo', match: true},
    ])
    assert.deepStrictEqual(lineParts('abc', []), [{text: 'abc', match: false}])
    // UTF-16 offsets: the emoji takes two units.
    assert.deepStrictEqual(lineParts('🙂 x', [[3, 4]]), [
        {text: '🙂 ', match: false},
        {text: 'x', match: true},
    ])
    // Overlapping or empty ranges are ignored.
    assert.deepStrictEqual(lineParts('abcd', [[0, 2], [1, 3], [3, 3]]), [
        {text: 'ab', match: true},
        {text: 'cd', match: false},
    ])
})

test('replaceTotals: excluded notes do not count', () => {
    const files = [
        {path: 'a.md', lines: [], total: 3},
        {path: 'b.md', lines: [], total: 2},
    ]
    assert.deepStrictEqual(replaceTotals(files, new Set()), {matches: 5, notes: 2})
    assert.deepStrictEqual(replaceTotals(files, new Set(['a.md'])), {matches: 2, notes: 1})
})

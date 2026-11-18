import test from 'node:test'
import assert from 'node:assert'
import esbuild from 'esbuild'

const out = esbuild.buildSync({entryPoints: ['src/lib/noteLists.ts'], bundle: true, format: 'cjs', write: false})
const mod = {exports: {}}
new Function('exports', 'module', out.outputFiles[0].text)(mod.exports, mod)
const {addRecent, togglePin, renameInList, removeFromList, switcherSections, MAX_RECENT} = mod.exports

test('addRecent: most recent first, no duplicates, capped', () => {
    let l = ['a', 'b', 'c']
    assert.deepStrictEqual(addRecent(l, 'c'), ['c', 'a', 'b'])
    assert.deepStrictEqual(addRecent(l, 'd'), ['d', 'a', 'b', 'c'])
    assert.strictEqual(addRecent(l, 'a'), l, 'unchanged list is returned as is')
    l = Array.from({length: MAX_RECENT}, (_, i) => `n${i}`)
    const next = addRecent(l, 'new')
    assert.strictEqual(next.length, MAX_RECENT)
    assert.strictEqual(next[0], 'new')
    assert.ok(!next.includes(`n${MAX_RECENT - 1}`))
})

test('togglePin: pins at the end, unpins in place', () => {
    assert.deepStrictEqual(togglePin(['a'], 'b'), ['a', 'b'])
    assert.deepStrictEqual(togglePin(['a', 'b', 'c'], 'b'), ['a', 'c'])
})

test('renameInList: notes and folders, merges duplicates', () => {
    assert.deepStrictEqual(renameInList(['d/a.md', 'x.md', 'd/s/b.md'], 'd', 'e'), ['e/a.md', 'x.md', 'e/s/b.md'])
    assert.deepStrictEqual(renameInList(['dx/a.md'], 'd', 'e'), ['dx/a.md'])
    assert.deepStrictEqual(renameInList(['a.md', 'b.md'], 'b.md', 'a.md'), ['a.md'])
    const l = ['a']
    assert.strictEqual(renameInList(l, 'z', 'y'), l)
})

test('removeFromList: by path (folder aware) or predicate', () => {
    assert.deepStrictEqual(removeFromList(['d/a', 'b', 'd/c'], 'd'), ['b'])
    assert.deepStrictEqual(removeFromList(['a', 'b'], (p) => p === 'b'), ['a'])
    const l = ['a']
    assert.strictEqual(removeFromList(l, 'z'), l)
})

test('switcherSections: pinned first, recent without pinned/current/missing, limited', () => {
    const existing = new Set(['p1', 'p2', 'r1', 'r2', 'r3', 'cur'])
    const s = switcherSections(['p2', 'gone', 'p1'], ['cur', 'p1', 'r1', 'gone', 'r2', 'r3'], existing, 'cur', 2)
    assert.deepStrictEqual(s, {pinned: ['p2', 'p1'], recent: ['r1', 'r2']})
})

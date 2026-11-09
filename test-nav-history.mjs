import test from 'node:test'
import assert from 'node:assert'
import esbuild from 'esbuild'

const out = esbuild.buildSync({entryPoints: ['src/lib/navHistory.ts'], bundle: true, format: 'cjs', write: false})
const mod = {exports: {}}
new Function('exports', 'module', out.outputFiles[0].text)(mod.exports, mod)
const {emptyHistory, pushHistory, canGoBack, canGoForward, stepHistory, renameInHistory, removeFromHistory, MAX_HISTORY} =
    mod.exports

const build = (...paths) => paths.reduce(pushHistory, emptyHistory)

test('push: appends, ignores re-opening the current note, drops forward entries', () => {
    let h = build('a', 'b', 'b', 'c')
    assert.deepStrictEqual(h, {entries: ['a', 'b', 'c'], index: 2})
    h = stepHistory(stepHistory(h, -1).history, -1).history
    assert.strictEqual(h.index, 0)
    h = pushHistory(h, 'd')
    assert.deepStrictEqual(h, {entries: ['a', 'd'], index: 1})
})

test('push: keeps at most MAX_HISTORY entries', () => {
    const h = build(...Array.from({length: MAX_HISTORY + 5}, (_, i) => `n${i}`))
    assert.strictEqual(h.entries.length, MAX_HISTORY)
    assert.strictEqual(h.entries[0], 'n5')
    assert.strictEqual(h.index, MAX_HISTORY - 1)
})

test('step: back and forward with bounds', () => {
    const h = build('a', 'b', 'c')
    assert.strictEqual(canGoBack(h), true)
    assert.strictEqual(canGoForward(h), false)
    assert.strictEqual(stepHistory(h, 1), null)
    const back = stepHistory(h, -1)
    assert.strictEqual(back.path, 'b')
    assert.strictEqual(canGoForward(back.history), true)
    assert.strictEqual(stepHistory(back.history, 1).path, 'c')
    assert.strictEqual(stepHistory(emptyHistory, -1), null)
    assert.strictEqual(canGoBack(emptyHistory), false)
    assert.strictEqual(canGoForward(emptyHistory), false)
})

test('rename: notes and folders are followed; equal neighbours merge', () => {
    let h = build('dir/a.md', 'b.md', 'dir/sub/c.md')
    h = renameInHistory(h, 'dir', 'new')
    assert.deepStrictEqual(h, {entries: ['new/a.md', 'b.md', 'new/sub/c.md'], index: 2})
    // "dirx" is not inside "dir".
    assert.deepStrictEqual(renameInHistory(build('dirx/a.md'), 'dir', 'z').entries, ['dirx/a.md'])
    // Renaming b onto a name already next to it merges the two entries.
    h = renameInHistory(build('a.md', 'b.md', 'c.md'), 'b.md', 'a.md')
    assert.deepStrictEqual(h, {entries: ['a.md', 'c.md'], index: 1})
})

test('remove: drops deleted notes/folders and keeps a sensible position', () => {
    // Current entry deleted: move to the one before it.
    let h = removeFromHistory(build('a', 'b', 'c'), 'c')
    assert.deepStrictEqual(h, {entries: ['a', 'b'], index: 1})
    // Entry before the current one deleted: current stays the same note.
    h = removeFromHistory(build('a', 'b', 'c'), 'a')
    assert.deepStrictEqual(h, {entries: ['b', 'c'], index: 1})
    // A, B, A with B deleted collapses to a single A.
    h = removeFromHistory(build('a', 'b', 'a'), 'b')
    assert.deepStrictEqual(h, {entries: ['a'], index: 0})
    // Folder delete removes everything inside it.
    h = removeFromHistory(build('d/x', 'y', 'd/z'), 'd')
    assert.deepStrictEqual(h, {entries: ['y'], index: 0})
    // Everything removed.
    assert.deepStrictEqual(removeFromHistory(build('a'), 'a'), {entries: [], index: -1})
    // Deleting the first entry while it is current moves forward instead.
    h = stepHistory(build('a', 'b'), -1).history
    assert.deepStrictEqual(removeFromHistory(h, 'a'), {entries: ['b'], index: 0})
})

test('remove: predicate form, e.g. drop entries no longer in the vault', () => {
    const existing = new Set(['a', 'c'])
    const h = removeFromHistory(build('a', 'b', 'c'), (p) => !existing.has(p))
    assert.deepStrictEqual(h, {entries: ['a', 'c'], index: 1})
})

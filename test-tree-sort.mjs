import test from 'node:test'
import assert from 'node:assert'
import esbuild from 'esbuild'

const out = esbuild.buildSync({entryPoints: ['src/lib/treeSort.ts'], bundle: true, format: 'cjs', write: false})
const mod = {exports: {}}
new Function('exports', 'module', out.outputFiles[0].text)(mod.exports, mod)
const {DEFAULT_TREE_SORT, normalizeTreeSort, compareNames, sortTree} = mod.exports

const file = (path, modified, created) => ({name: path.split('/').pop(), path, isDir: false, modified, created})
const dir = (path, children, modified, created) => ({name: path.split('/').pop(), path, isDir: true, children, modified, created})

const tree = dir('.', [
    file('b.md', 300, 100),
    file('note 10.md', 100, 300),
    dir('zeta', [file('zeta/new.md', 900, 50)], 10, 10),
    file('A.md', 200, 200),
    dir('alpha', [file('alpha/old.md', 50, 400)], 20, 500),
    file('note 2.md', undefined, undefined),
])
const names = (node) => node.children.map((c) => c.name)

test('normalizeTreeSort: defaults and per-field validation', () => {
    assert.deepStrictEqual(normalizeTreeSort(null), DEFAULT_TREE_SORT)
    assert.deepStrictEqual(normalizeTreeSort({by: 'size', direction: 'up', foldersFirst: 'yes'}), DEFAULT_TREE_SORT)
    // Times default to newest first when no direction was stored.
    assert.deepStrictEqual(normalizeTreeSort({by: 'modified'}), {by: 'modified', direction: 'desc', foldersFirst: true})
    assert.deepStrictEqual(normalizeTreeSort({by: 'created', direction: 'asc', foldersFirst: false}), {by: 'created', direction: 'asc', foldersFirst: false})
})

test('compareNames: natural and case-insensitive', () => {
    const sorted = ['note 10', 'B', 'note 2', 'a'].sort(compareNames)
    assert.deepStrictEqual(sorted, ['a', 'B', 'note 2', 'note 10'])
})

test('sortTree by name: default order is folders first, A→Z, natural numbers', () => {
    assert.deepStrictEqual(names(sortTree(tree, DEFAULT_TREE_SORT)), ['alpha', 'zeta', 'A.md', 'b.md', 'note 2.md', 'note 10.md'])
    assert.deepStrictEqual(names(sortTree(tree, {by: 'name', direction: 'desc', foldersFirst: true})), ['zeta', 'alpha', 'note 10.md', 'note 2.md', 'b.md', 'A.md'])
    assert.deepStrictEqual(names(sortTree(tree, {by: 'name', direction: 'asc', foldersFirst: false})), ['A.md', 'alpha', 'b.md', 'note 2.md', 'note 10.md', 'zeta'])
})

test('sortTree by modified: folders use their newest file; missing times go last', () => {
    // zeta's newest file is 900, alpha's is 50.
    assert.deepStrictEqual(names(sortTree(tree, {by: 'modified', direction: 'desc', foldersFirst: false})), ['zeta', 'b.md', 'A.md', 'note 10.md', 'alpha', 'note 2.md'])
    assert.deepStrictEqual(names(sortTree(tree, {by: 'modified', direction: 'asc', foldersFirst: true})), ['alpha', 'zeta', 'note 10.md', 'A.md', 'b.md', 'note 2.md'])
})

test('sortTree by created: own creation time, falling back to modified', () => {
    assert.deepStrictEqual(names(sortTree(tree, {by: 'created', direction: 'desc', foldersFirst: false})), ['alpha', 'note 10.md', 'A.md', 'b.md', 'zeta', 'note 2.md'])
})

test('sortTree: sorts nested folders, keeps fields, does not mutate the input', () => {
    const nested = dir('.', [dir('d', [file('d/b.md', 1), file('d/a.md', 2)], 0)])
    const before = JSON.stringify(nested)
    const sorted = sortTree(nested, DEFAULT_TREE_SORT)
    assert.deepStrictEqual(names(sorted.children[0]), ['a.md', 'b.md'])
    assert.strictEqual(sorted.children[0].children[0].modified, 2)
    assert.strictEqual(JSON.stringify(nested), before)
})

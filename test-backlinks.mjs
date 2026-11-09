import test from 'node:test'
import assert from 'node:assert'
import esbuild from 'esbuild'

const out = esbuild.buildSync({entryPoints: ['src/lib/backlinks.ts'], bundle: true, format: 'cjs', write: false})
const mod = {exports: {}}
new Function('exports', 'module', out.outputFiles[0].text)(mod.exports, mod)
const {joinRelative, resolveLinkRef, groupBacklinks, snippetParts} = mod.exports

const paths = ['Target.md', 'projects/Target.md', 'a.md', 'projects/b.md', 'deep/x/c.md']

test('joinRelative: dots, parents and escaping the vault', () => {
    assert.strictEqual(joinRelative('projects', '../Target.md'), 'Target.md')
    assert.strictEqual(joinRelative('deep/x', './../../a.md'), 'a.md')
    assert.strictEqual(joinRelative('', 'projects/b.md'), 'projects/b.md')
    assert.strictEqual(joinRelative('', '../a.md'), null)
    assert.strictEqual(joinRelative('deep', '/a.md'), 'a.md')
})

test('resolveLinkRef: wiki links use the WikiLink rules, Markdown links the relative path', () => {
    // Bare name from inside "projects": the note in the same folder wins.
    assert.strictEqual(resolveLinkRef({source: 'projects/b.md', target: 'Target', kind: 'wiki'}, paths), 'projects/Target.md')
    assert.strictEqual(resolveLinkRef({source: 'a.md', target: 'Target', kind: 'wiki'}, paths), 'Target.md')
    assert.strictEqual(resolveLinkRef({source: 'projects/b.md', target: '../Target.md', kind: 'markdown'}, paths), 'Target.md')
    assert.strictEqual(resolveLinkRef({source: 'a.md', target: 'projects/target.md', kind: 'markdown'}, paths), 'projects/Target.md')
    assert.strictEqual(resolveLinkRef({source: 'a.md', target: 'missing.md', kind: 'markdown'}, paths), null)
})

test('groupBacklinks: only links that resolve to the note, grouped and sorted', () => {
    const refs = [
        {source: 'projects/b.md', target: 'Target', kind: 'wiki', line: 3, context: 'see [[Target]]'},
        {source: 'a.md', target: 'Target', kind: 'wiki', line: 7, context: 'later [[Target]]'},
        {source: 'a.md', target: 'Target', kind: 'wiki', line: 2, context: '[[Target]] and [[Target|again]]'},
        {source: 'a.md', target: 'Target', kind: 'wiki', line: 2, context: '[[Target]] and [[Target|again]]'},
        {source: 'deep/x/c.md', target: '../../Target.md', kind: 'markdown', line: 1, context: '[t](../../Target.md)'},
        {source: 'Target.md', target: 'Target', kind: 'wiki', line: 1, context: 'self'},
    ]
    assert.deepStrictEqual(groupBacklinks(refs, 'Target.md', paths), [
        {source: 'a.md', mentions: [{line: 2, context: '[[Target]] and [[Target|again]]'}, {line: 7, context: 'later [[Target]]'}]},
        {source: 'deep/x/c.md', mentions: [{line: 1, context: '[t](../../Target.md)'}]},
    ])
    // The same refs seen from projects/Target.md: only b.md's bare link resolves there.
    assert.deepStrictEqual(groupBacklinks(refs, 'projects/Target.md', paths).map((g) => g.source), ['projects/b.md'])
})

test('snippetParts: ** markers become highlighted parts', () => {
    assert.deepStrictEqual(snippetParts('a **Road** b **map**'), [
        {text: 'a ', match: false},
        {text: 'Road', match: true},
        {text: ' b ', match: false},
        {text: 'map', match: true},
    ])
})

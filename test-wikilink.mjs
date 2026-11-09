import test from 'node:test'
import assert from 'node:assert'
import esbuild from 'esbuild'

const out = esbuild.buildSync({entryPoints: ['src/lib/wikilink.ts'], bundle: true, format: 'cjs', write: false})
const mod = {exports: {}}
new Function('exports', 'module', out.outputFiles[0].text)(mod.exports, mod)
const {parseWikiLink, wikiLinkLabel, resolveWikiLink, newNoteLocation, collectFilePaths, findHeadingLine} = mod.exports

test('parseWikiLink: target, heading and alias', () => {
    assert.deepStrictEqual(parseWikiLink('Note'), {target: 'Note', heading: null, alias: null})
    assert.deepStrictEqual(parseWikiLink('dir/Note#Sec 1|Shown'), {target: 'dir/Note', heading: 'Sec 1', alias: 'Shown'})
    assert.deepStrictEqual(parseWikiLink('#Only heading'), {target: '', heading: 'Only heading', alias: null})
    assert.deepStrictEqual(parseWikiLink(' /dir\\Note '), {target: 'dir/Note', heading: null, alias: null})
})

test('wikiLinkLabel: alias wins, otherwise the text before "|"', () => {
    assert.strictEqual(wikiLinkLabel('Note|Alias'), 'Alias')
    assert.strictEqual(wikiLinkLabel('Note#H'), 'Note#H')
    assert.strictEqual(wikiLinkLabel('Note|'), 'Note')
})

const paths = [
    'Home.md',
    'projects/Roadmap.md',
    'archive/Roadmap.md',
    'archive/old/Roadmap.md',
    'projects/spec.txt',
    'img/diagram.png',
    'v1.2 notes.md',
]

test('resolveWikiLink: basename match prefers the current folder, then the shortest path', () => {
    assert.strictEqual(resolveWikiLink('roadmap', paths, 'archive/x.md'), 'archive/Roadmap.md')
    assert.strictEqual(resolveWikiLink('Roadmap', paths, 'Home.md'), 'archive/Roadmap.md')
    assert.strictEqual(resolveWikiLink('Roadmap', paths, 'projects/a.md'), 'projects/Roadmap.md')
    assert.strictEqual(resolveWikiLink('home', paths, null), 'Home.md')
})

test('resolveWikiLink: folder paths, extensions and misses', () => {
    assert.strictEqual(resolveWikiLink('archive/old/Roadmap', paths, 'projects/a.md'), 'archive/old/Roadmap.md')
    assert.strictEqual(resolveWikiLink('old/Roadmap', paths, null), 'archive/old/Roadmap.md')
    assert.strictEqual(resolveWikiLink('Roadmap.md', paths, 'projects/a.md'), 'projects/Roadmap.md')
    assert.strictEqual(resolveWikiLink('diagram.png', paths, null), 'img/diagram.png')
    assert.strictEqual(resolveWikiLink('spec', paths, null), null, 'a bare name only matches Markdown notes')
    assert.strictEqual(resolveWikiLink('v1.2 notes', paths, null), 'v1.2 notes.md')
    assert.strictEqual(resolveWikiLink('Missing', paths, null), null)
    assert.strictEqual(resolveWikiLink('', paths, null), null)
})

test('newNoteLocation: next to the current note, or at the given vault path', () => {
    assert.deepStrictEqual(newNoteLocation('Idea', 'projects/a.md'), {parent: 'projects', name: 'Idea.md'})
    assert.deepStrictEqual(newNoteLocation('Idea', null), {parent: '', name: 'Idea.md'})
    assert.deepStrictEqual(newNoteLocation('a/b/Idea', 'x/y.md'), {parent: 'a/b', name: 'Idea.md'})
    assert.deepStrictEqual(newNoteLocation('v1.2 notes', ''), {parent: '', name: 'v1.2 notes.md'})
    assert.deepStrictEqual(newNoteLocation('What?', ''), {parent: '', name: 'What_.md'})
})

test('collectFilePaths: walks nested folders', () => {
    const tree = {path: '', isDir: true, children: [
        {path: 'a.md', isDir: false},
        {path: 'd', isDir: true, children: [{path: 'd/b.md', isDir: false}]},
    ]}
    assert.deepStrictEqual(collectFilePaths(tree), ['a.md', 'd/b.md'])
    assert.deepStrictEqual(collectFilePaths(null), [])
})

test('findHeadingLine: matches ATX headings case-insensitively, skipping code fences', () => {
    const doc = '# Title\n\n```\n## Setup\n```\n## Setup ##\ntext\n### Next'
    assert.strictEqual(findHeadingLine(doc, 'setup'), 6)
    assert.strictEqual(findHeadingLine(doc, 'Next'), 8)
    assert.strictEqual(findHeadingLine(doc, 'title'), 1)
    assert.strictEqual(findHeadingLine(doc, 'nope'), null)
})

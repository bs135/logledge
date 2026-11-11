import test from 'node:test'
import assert from 'node:assert'
import esbuild from 'esbuild'

const out = esbuild.buildSync({entryPoints: ['src/lib/wikilink.ts'], bundle: true, format: 'cjs', write: false})
const mod = {exports: {}}
new Function('exports', 'module', out.outputFiles[0].text)(mod.exports, mod)
const {parseWikiLink, wikiLinkLabel, resolveWikiLink, newNoteLocation, collectFilePaths, findHeadingLine, wikiCompletionContext, noteCompletionEntries, extractHeadings, headingLinkText} = mod.exports

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

test('wikiCompletionContext: note and heading contexts', () => {
    assert.deepStrictEqual(wikiCompletionContext('See [[Roa'), {offset: 6, query: 'Roa', kind: 'note', target: ''})
    assert.deepStrictEqual(wikiCompletionContext('[['), {offset: 2, query: '', kind: 'note', target: ''})
    assert.deepStrictEqual(wikiCompletionContext('x [[dir/Note#Se'), {offset: 13, query: 'Se', kind: 'heading', target: 'dir/Note'})
    assert.deepStrictEqual(wikiCompletionContext('[[#'), {offset: 3, query: '', kind: 'heading', target: ''})
})

test('wikiCompletionContext: no completion outside an open link or after "|"', () => {
    assert.strictEqual(wikiCompletionContext('plain text'), null)
    assert.strictEqual(wikiCompletionContext('[single'), null)
    assert.strictEqual(wikiCompletionContext('[[Done]] after'), null)
    assert.strictEqual(wikiCompletionContext('[[Note|ali'), null)
    // The last open "[[" counts, not an earlier closed one.
    assert.deepStrictEqual(wikiCompletionContext('[[A]] and [[B'), {offset: 12, query: 'B', kind: 'note', target: ''})
})

test('noteCompletionEntries: shortest suffix that still resolves to the same note', () => {
    const all = ['Home.md', 'projects/Roadmap.md', 'archive/Roadmap.md', 'archive/old/Roadmap.md', 'a/b.md', 'x/a/b.md', 'img/pic.png', 'notes.txt']
    const entries = noteCompletionEntries(all)
    assert.deepStrictEqual(entries.map((e) => e.label), ['Home', 'projects/Roadmap', 'archive/Roadmap', 'old/Roadmap', 'a/b', 'x/a/b'])
    for (const e of entries) {
        assert.strictEqual(resolveWikiLink(e.label, all, 'somewhere/else.md'), e.path, `label ${e.label} resolves back`)
    }
    assert.strictEqual(entries[1].folder, 'projects')
    assert.strictEqual(entries[0].folder, '')
})

test('extractHeadings: levels and text, fences skipped', () => {
    assert.deepStrictEqual(extractHeadings('# A\ntext\n```\n# not\n```\n### B ##\n#nospace'), [
        {level: 1, text: 'A'},
        {level: 3, text: 'B'},
    ])
})

test('headingLinkText: links reduced to their text, link-breaking characters dropped', () => {
    assert.strictEqual(headingLinkText('[[README.md]]'), 'README.md')
    assert.strictEqual(headingLinkText('See [[Note|the note]] now'), 'See the note now')
    assert.strictEqual(headingLinkText('Docs [site](https://x.y) here'), 'Docs site here')
    assert.strictEqual(headingLinkText('C# | F#  [draft]'), 'C F draft')
    assert.strictEqual(headingLinkText('Plain heading'), 'Plain heading')
})

test('headings containing WikiLinks: completion text and lookup agree', () => {
    const doc = '# Intro\n## [[README.md]]\n### See [[A|alias]]'
    assert.deepStrictEqual(extractHeadings(doc).map((h) => h.text), ['Intro', 'README.md', 'See alias'])
    assert.strictEqual(findHeadingLine(doc, 'README.md'), 2)
    assert.strictEqual(findHeadingLine(doc, 'see alias'), 3)
    // The raw heading text still finds it (e.g. a link typed by hand).
    assert.strictEqual(findHeadingLine(doc, '[[README.md]]'), 2)
    // What the completion inserts is a valid link that parses back to the same heading.
    const inserted = `#${extractHeadings(doc)[1].text}`
    assert.deepStrictEqual(parseWikiLink(inserted), {target: '', heading: 'README.md', alias: null})
})

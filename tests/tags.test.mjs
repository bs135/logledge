import test from 'node:test'
import assert from 'node:assert'
import esbuild from 'esbuild'

const out = esbuild.buildSync({entryPoints: ['src/lib/tags.ts'], bundle: true, format: 'cjs', write: false})
const mod = {exports: {}}
new Function('exports', 'module', out.outputFiles[0].text)(mod.exports, mod)
const {normalizeTag, findInlineTags, frontMatterLength, buildTagTree} = mod.exports

const tags = (text) => findInlineTags(text).map((m) => m.tag)

// Same cases as src-tauri/src/tags.rs.
test('findInlineTags: tags and boundaries', () => {
    assert.deepStrictEqual(tags('Plan #Work and #work/Q3, (#idea) #ý-tưởng'), ['work', 'work/q3', 'idea', 'ý-tưởng'])
    assert.deepStrictEqual(tags('a#b https://x.y/#frag [h](#anchor) \\#esc #123 #1-2 # Heading'), [])
    assert.deepStrictEqual(tags('#a/b/ #/c #d//e'), ['a/b'])
})

test('findInlineTags: offsets cover "#" and the tag, in UTF-16 units', () => {
    const text = '🙂 #ok/ then'
    const [m] = findInlineTags(text)
    assert.strictEqual(text.slice(m.from, m.to), '#ok')
})

test('normalizeTag rules', () => {
    assert.strictEqual(normalizeTag('#Work/'), 'work')
    assert.strictEqual(normalizeTag('12'), null)
    assert.strictEqual(normalizeTag('a b'), null)
    assert.strictEqual(normalizeTag('2024-plan'), '2024-plan')
})

test('frontMatterLength', () => {
    const doc = '---\ntags: [a]\n---\n#body'
    assert.strictEqual(doc.slice(0, frontMatterLength(doc)), '---\ntags: [a]\n---')
    assert.strictEqual(frontMatterLength('---\nno end'), 0)
    assert.strictEqual(frontMatterLength('text\n---\n'), 0)
    assert.strictEqual(frontMatterLength('---\nx: 1\n...\nrest'), '---\nx: 1\n...'.length)
})

test('buildTagTree: nested, sorted, parents without own notes have count 0', () => {
    const tree = buildTagTree([
        {tag: 'work/q3', count: 1},
        {tag: 'home', count: 2},
        {tag: 'work/q1', count: 3},
        {tag: 'proj/a/b', count: 1},
    ])
    assert.deepStrictEqual(
        tree.map((n) => [n.tag, n.count, n.children.map((c) => [c.tag, c.count])]),
        [
            ['home', 2, []],
            ['proj', 0, [['proj/a', 0]]],
            ['work', 0, [['work/q1', 3], ['work/q3', 1]]],
        ],
    )
    assert.strictEqual(tree[1].children[0].children[0].tag, 'proj/a/b')
})

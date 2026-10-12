import test from 'node:test'
import assert from 'node:assert'
import {createRequire} from 'node:module'
import esbuild from 'esbuild'
import {EditorState} from '@codemirror/state'
import {markdown, markdownLanguage} from '@codemirror/lang-markdown'
import {GFM, Table, TaskList, Strikethrough} from '@lezer/markdown'

const require = createRequire(import.meta.url)

// Compile livePreview.ts using esbuild to test directly in Node.js
const buildResult = esbuild.buildSync({
    entryPoints: ['src/components/livePreview.ts'],
    bundle: true,
    format: 'cjs',
    write: false,
    external: ['@codemirror/*', '@lezer/*'],
})

const mod = {exports: {}}
const runFn = new Function('require', 'exports', 'module', buildResult.outputFiles[0].text)
runFn(require, mod.exports, mod)
const {LivePreviewPlugin} = mod.exports

function createTestView(doc, selectionAnchor = 0) {
    const state = EditorState.create({
        doc,
        selection: {anchor: selectionAnchor},
        extensions: [
            markdown({
                base: markdownLanguage,
                extensions: [GFM, Table, TaskList, Strikethrough],
            }),
        ],
    })
    return {
        state,
        visibleRanges: [{from: 0, to: doc.length}],
    }
}

test('Headings: reveals prefix when cursor is on heading line, hides when cursor is away', () => {
    const doc = '# First Heading\nSecond line'

    // Case 1: Cursor on heading line
    const view1 = createTestView(doc, 0)
    const plugin1 = new LivePreviewPlugin(view1)
    let foundHeadingLine = false
    let foundFormattedPrefix = false
    let foundHiddenPrefix = false

    plugin1.decorations.between(0, doc.length, (from, to, val) => {
        if (val.spec?.class?.includes('cm-heading-1')) foundHeadingLine = true
        if (from === 0 && to === 2 && val.spec?.class?.includes('cm-formatting')) foundFormattedPrefix = true
        if (from === 0 && to === 2 && !val.spec?.class) foundHiddenPrefix = true
    })

    assert.strictEqual(foundHeadingLine, true, 'Heading line decoration should be applied')
    assert.strictEqual(foundFormattedPrefix, true, 'Prefix # should be formatted and visible when cursor on line')
    assert.strictEqual(foundHiddenPrefix, false, 'Prefix # should NOT be hidden when cursor on line')

    // Case 2: Cursor on second line
    const view2 = createTestView(doc, 18)
    const plugin2 = new LivePreviewPlugin(view2)
    let foundHiddenPrefix2 = false
    plugin2.decorations.between(0, doc.length, (from, to, val) => {
        if (from === 0 && to === 2 && !val.spec?.class) foundHiddenPrefix2 = true
    })
    assert.strictEqual(foundHiddenPrefix2, true, 'Prefix # should be hidden when cursor is away from heading line')
})

test('Strong Emphasis: hides ** when cursor is away, reveals ** when cursor is inside', () => {
    const doc = 'Normal text **bold word** more text'
    // 'bold word' starts at 14, ends at 23. Node is 12..25.

    // Case 1: Cursor is away at 0
    const view1 = createTestView(doc, 0)
    const plugin1 = new LivePreviewPlugin(view1)
    let hiddenOpen = false
    let hiddenClose = false
    let boldTextMark = false

    plugin1.decorations.between(0, doc.length, (from, to, val) => {
        if (from === 12 && to === 14 && !val.spec?.class) hiddenOpen = true
        if (from === 23 && to === 25 && !val.spec?.class) hiddenClose = true
        if (from === 14 && to === 23 && val.spec?.class?.includes('font-bold')) boldTextMark = true
    })

    assert.strictEqual(hiddenOpen, true, 'Opening ** should be hidden when cursor is away')
    assert.strictEqual(hiddenClose, true, 'Closing ** should be hidden when cursor is away')
    assert.strictEqual(boldTextMark, true, 'Inner text should be bold')

    // Case 2: Cursor is inside bold text at 16
    const view2 = createTestView(doc, 16)
    const plugin2 = new LivePreviewPlugin(view2)
    let visibleOpen = false
    let visibleClose = false

    plugin2.decorations.between(0, doc.length, (from, to, val) => {
        if (from === 12 && to === 14 && val.spec?.class?.includes('cm-formatting')) visibleOpen = true
        if (from === 23 && to === 25 && val.spec?.class?.includes('cm-formatting')) visibleClose = true
    })

    assert.strictEqual(visibleOpen, true, 'Opening ** should be revealed with formatting when cursor is inside')
    assert.strictEqual(visibleClose, true, 'Closing ** should be revealed with formatting when cursor is inside')
})

test('Task Checkbox: replaces [ ] with checkbox widget when cursor away, reveals [ ] when on marker', () => {
    const doc = '- [ ] Buy groceries'

    // Case 1: Cursor is away at 10
    const view1 = createTestView(doc, 10)
    const plugin1 = new LivePreviewPlugin(view1)
    let hasCheckboxWidget = false

    plugin1.decorations.between(0, doc.length, (from, to, val) => {
        if (from === 2 && to === 5 && val.spec?.widget?.constructor?.name === 'CheckboxWidget') {
            hasCheckboxWidget = true
        }
    })
    assert.strictEqual(hasCheckboxWidget, true, 'Checkbox widget should replace [ ] when cursor is away')

    // Case 2: Cursor is at position 3 (inside [ ])
    const view2 = createTestView(doc, 3)
    const plugin2 = new LivePreviewPlugin(view2)
    let rawMarkerRevealed = false

    plugin2.decorations.between(0, doc.length, (from, to, val) => {
        if (from === 2 && to === 5 && val.spec?.class?.includes('font-mono')) {
            rawMarkerRevealed = true
        }
    })
    assert.strictEqual(rawMarkerRevealed, true, 'Raw marker [ ] should be revealed when cursor is on it')
})

test('Links: hides delimiters when cursor is away, reveals syntax when cursor is on link', () => {
    const doc = 'Check this [documentation](https://logledge.dev) for details'
    // Link starts at 11, ends at 48.

    // Case 1: Cursor is away at 0
    const view1 = createTestView(doc, 0)
    const plugin1 = new LivePreviewPlugin(view1)
    let linkMark = false
    let hiddenBracket = false
    let hiddenURL = false

    plugin1.decorations.between(0, doc.length, (from, to, val) => {
        if (from === 11 && to === 12 && !val.spec?.class) hiddenBracket = true
        if (from === 12 && to === 25 && val.spec?.class?.includes('cm-link')) {
            linkMark = true
            assert.strictEqual(val.spec?.attributes?.['data-url'], 'https://logledge.dev')
        }
        if (from === 25 && to === 48 && !val.spec?.class) hiddenURL = true
    })

    assert.strictEqual(hiddenBracket, true, 'Opening [ should be hidden')
    assert.strictEqual(linkMark, true, 'Link label should have cm-link and data-url')
    assert.strictEqual(hiddenURL, true, '](url) should be hidden')

    // Case 2: Cursor is inside link at 20
    const view2 = createTestView(doc, 20)
    const plugin2 = new LivePreviewPlugin(view2)
    let visibleBracket = false
    let visibleURL = false

    plugin2.decorations.between(0, doc.length, (from, to, val) => {
        if (from === 11 && to === 12 && val.spec?.class?.includes('cm-formatting')) visibleBracket = true
        if (from === 25 && to === 48 && val.spec?.class?.includes('cm-formatting')) visibleURL = true
    })

    assert.strictEqual(visibleBracket, true, 'Opening [ should be visible in formatting style')
    assert.strictEqual(visibleURL, true, 'Closing ](url) should be visible in formatting style')
})

test('WikiLinks: hides [[ and ]] when cursor away, reveals syntax when cursor is inside', () => {
    const doc = 'Refer to [[Project Roadmap]] for details'

    // Case 1: Cursor away
    const view1 = createTestView(doc, 0)
    const plugin1 = new LivePreviewPlugin(view1)
    let wikiLinkMark = false

    plugin1.decorations.between(0, doc.length, (from, to, val) => {
        if (val.spec?.class?.includes('cm-wikilink')) wikiLinkMark = true
    })
    assert.strictEqual(wikiLinkMark, true, 'WikiLink styling should be applied')

    // Case 2: Cursor inside [[Project Roadmap]]
    const view2 = createTestView(doc, 15)
    const plugin2 = new LivePreviewPlugin(view2)
    let visibleDelims = 0

    plugin2.decorations.between(0, doc.length, (from, to, val) => {
        if (val.spec?.class?.includes('cm-formatting')) visibleDelims++
    })
    assert.strictEqual(visibleDelims >= 2, true, 'Delimiters [[ and ]] should be visible when cursor is inside')
})

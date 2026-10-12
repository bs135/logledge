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

test('Fenced Code Block: Live Preview reveals on cursor, renders header & collapses footer when cursor away', () => {
    const doc = '```typescript\nconst greeting = "hello";\n```\nSome trailing text'
    // startLine: 0..13 (```typescript)
    // middle: 14..39 (const greeting = "hello";)
    // endLine: 40..43 (```)
    // trailing text: 44..62 (Some trailing text)

    // Case 1: Cursor away at position 50 (on trailing text)
    const view1 = createTestView(doc, 50)
    const plugin1 = new LivePreviewPlugin(view1)
    let headerWidget = null
    let hasHeaderLineClass = false
    let hasFooterLineClass = false
    let hasFooterReplace = false

    plugin1.decorations.between(0, doc.length, (from, to, val) => {
        if (from === 0 && to === 13 && val.spec?.widget?.constructor?.name === 'CodeBlockHeaderWidget') {
            headerWidget = val.spec.widget
        }
        if (val.spec?.class?.includes('cm-codeblock-header-line')) {
            hasHeaderLineClass = true
        }
        if (val.spec?.class?.includes('cm-codeblock-footer')) {
            hasFooterLineClass = true
        }
        if (from === 40 && to === 43 && !val.spec?.class && !val.spec?.widget) {
            hasFooterReplace = true
        }
    })

    assert.ok(headerWidget, 'CodeBlockHeaderWidget should replace start line when cursor is away')
    assert.strictEqual(headerWidget.lang, 'typescript', 'Header widget should extract language name')
    assert.strictEqual(headerWidget.code, 'const greeting = "hello";', 'Header widget should extract code content')
    assert.strictEqual(hasHeaderLineClass, true, 'Start line should have cm-codeblock-header-line when inactive')
    assert.strictEqual(hasFooterLineClass, true, 'End line should have cm-codeblock-footer when inactive')
    assert.strictEqual(hasFooterReplace, true, 'End line should have replacement decoration when inactive')

    // Case 2: Cursor on startLine at position 0
    const view2 = createTestView(doc, 0)
    const plugin2 = new LivePreviewPlugin(view2)
    let startLineRevealed = true
    let foundStartFenceMark = false
    let foundLangMark = false

    plugin2.decorations.between(0, doc.length, (from, to, val) => {
        if (from === 0 && to === 13 && val.spec?.widget?.constructor?.name === 'CodeBlockHeaderWidget') {
            startLineRevealed = false
        }
        if (from === 0 && to === 3 && val.spec?.class?.includes('cm-formatting')) {
            foundStartFenceMark = true
        }
        if (from === 3 && to === 13 && val.spec?.class?.includes('cm-formatting')) {
            foundLangMark = true
        }
    })

    assert.strictEqual(startLineRevealed, true, 'Start line should NOT be replaced by widget when cursor is on it')
    assert.strictEqual(foundStartFenceMark, true, 'Opening ``` should have formatting mark when cursor is on it')
    assert.strictEqual(foundLangMark, true, 'Language name should have formatting mark when cursor is on it')

    // Case 3: Cursor on endLine at position 41
    const view3 = createTestView(doc, 41)
    const plugin3 = new LivePreviewPlugin(view3)
    let endLineHidden = false
    let foundEndFenceMark = false

    plugin3.decorations.between(0, doc.length, (from, to, val) => {
        if (from === 40 && to === 43 && !val.spec?.class && !val.spec?.widget) {
            endLineHidden = true
        }
        if (from === 40 && to === 43 && val.spec?.class?.includes('cm-formatting')) {
            foundEndFenceMark = true
        }
    })

    assert.strictEqual(endLineHidden, false, 'End line should NOT be hidden when cursor is on it')
    assert.strictEqual(foundEndFenceMark, true, 'Closing ``` should be revealed with formatting mark when cursor is on it')

    // Case 4: Cursor on code line at position 20
    const view4 = createTestView(doc, 20)
    const plugin4 = new LivePreviewPlugin(view4)
    let headerActive = false
    let footerCollapsed = false

    plugin4.decorations.between(0, doc.length, (from, to, val) => {
        if (from === 0 && to === 13 && val.spec?.widget?.constructor?.name === 'CodeBlockHeaderWidget') {
            headerActive = true
        }
        if (val.spec?.class?.includes('cm-codeblock-footer')) {
            footerCollapsed = true
        }
    })

    assert.strictEqual(headerActive, true, 'Header should remain in preview mode when editing code line')
    assert.strictEqual(footerCollapsed, true, 'Footer should remain collapsed when editing code line')
})

test('Fenced Code Block: unclosed block does not collapse code lines as footer', () => {
    const doc = '```python\nprint("hello")'
    const view = createTestView(doc, 0)
    const plugin = new LivePreviewPlugin(view)
    let hasFooterClass = false

    plugin.decorations.between(0, doc.length, (from, to, val) => {
        if (val.spec?.class?.includes('cm-codeblock-footer')) {
            hasFooterClass = true
        }
    })

    assert.strictEqual(hasFooterClass, false, 'Unclosed block should not collapse last line as footer')
})

test('Language Resolution: correctly maps aliases and standard names', async () => {
    // Compile and import syntaxHighlight.ts using esbuild
    const res = esbuild.buildSync({
        entryPoints: ['src/components/syntaxHighlight.ts'],
        bundle: true,
        format: 'cjs',
        write: false,
        external: ['@codemirror/*', '@lezer/*'],
    })
    const mod2 = {exports: {}}
    const runFn2 = new Function('require', 'exports', 'module', res.outputFiles[0].text)
    runFn2(require, mod2.exports, mod2)
    const {resolveCodeLanguage, markdownHighlightStyle} = mod2.exports

    assert.strictEqual(resolveCodeLanguage('javascript')?.name, 'JavaScript')
    assert.strictEqual(resolveCodeLanguage('js')?.name, 'JavaScript')
    assert.strictEqual(resolveCodeLanguage('py')?.name, 'Python')
    assert.strictEqual(resolveCodeLanguage('golang')?.name, 'Go')
    assert.strictEqual(resolveCodeLanguage('rs')?.name, 'Rust')
    assert.strictEqual(resolveCodeLanguage('sh')?.name, 'Shell')
    assert.strictEqual(resolveCodeLanguage('bash')?.name, 'Shell')
    assert.strictEqual(resolveCodeLanguage('yml')?.name, 'YAML')
    assert.strictEqual(resolveCodeLanguage('ts')?.name, 'TypeScript')

    // Verify markdownHighlightStyle is defined
    assert.ok(markdownHighlightStyle, 'markdownHighlightStyle should be defined')
})

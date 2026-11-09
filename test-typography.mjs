import test from 'node:test'
import assert from 'node:assert'
import esbuild from 'esbuild'

const out = esbuild.buildSync({entryPoints: ['src/lib/typography.ts'], bundle: true, format: 'cjs', write: false})
const mod = {exports: {}}
new Function('exports', 'module', out.outputFiles[0].text)(mod.exports, mod)
const {DEFAULT_TYPOGRAPHY, FONT_SIZE_MIN, FONT_SIZE_MAX, LINE_WIDTH_MIN, LINE_WIDTH_MAX, normalizeTypography, zoomTypography, zoomPercent, typographyCssVars} =
    mod.exports

test('normalizeTypography: defaults for missing or invalid data', () => {
    assert.deepStrictEqual(normalizeTypography(null), DEFAULT_TYPOGRAPHY)
    assert.deepStrictEqual(normalizeTypography('junk'), DEFAULT_TYPOGRAPHY)
    assert.deepStrictEqual(normalizeTypography({fontSize: 'big', font: 'comic', lineWidth: 'x'}), DEFAULT_TYPOGRAPHY)
    assert.deepStrictEqual(normalizeTypography({fontSize: NaN}), DEFAULT_TYPOGRAPHY)
})

test('normalizeTypography: clamps and rounds values', () => {
    assert.deepStrictEqual(normalizeTypography({fontSize: 99, font: 'serif', lineWidth: 10}), {
        fontSize: FONT_SIZE_MAX,
        font: 'serif',
        lineWidth: LINE_WIDTH_MIN,
    })
    assert.deepStrictEqual(normalizeTypography({fontSize: 3, font: 'mono', lineWidth: 99999}), {
        fontSize: FONT_SIZE_MIN,
        font: 'mono',
        lineWidth: LINE_WIDTH_MAX,
    })
    assert.strictEqual(normalizeTypography({fontSize: 17.6}).fontSize, 18)
    assert.strictEqual(normalizeTypography({lineWidth: null}).lineWidth, null)
})

test('zoomTypography: steps within bounds, 0 resets, unchanged returns same object', () => {
    const t = {...DEFAULT_TYPOGRAPHY, font: 'serif'}
    assert.strictEqual(zoomTypography(t, 1).fontSize, 17)
    assert.strictEqual(zoomTypography(t, 1).font, 'serif', 'other settings are kept')
    assert.strictEqual(zoomTypography(t, -1).fontSize, 15)
    assert.strictEqual(zoomTypography({...t, fontSize: 22}, 0).fontSize, DEFAULT_TYPOGRAPHY.fontSize)
    const max = {...t, fontSize: FONT_SIZE_MAX}
    assert.strictEqual(zoomTypography(max, 1), max)
    assert.strictEqual(zoomTypography(t, 0), t)
})

test('zoomPercent and CSS variables', () => {
    assert.strictEqual(zoomPercent(DEFAULT_TYPOGRAPHY), 100)
    assert.strictEqual(zoomPercent({...DEFAULT_TYPOGRAPHY, fontSize: 18}), 113)
    const vars = typographyCssVars({fontSize: 18, font: 'mono', lineWidth: null})
    assert.strictEqual(vars['--editor-font-size'], '18px')
    assert.strictEqual(vars['--editor-line-width'], 'none')
    assert.match(vars['--editor-font-family'], /monospace/)
    assert.strictEqual(typographyCssVars({...DEFAULT_TYPOGRAPHY, lineWidth: 760})['--editor-line-width'], '760px')
})

// Editor typography settings: font size (also changed by Ctrl+= / Ctrl+- / Ctrl+0),
// font family and an optional readable line width. Applied as CSS custom properties.

export type EditorFont = 'sans' | 'serif' | 'mono' | 'system'

export interface Typography {
    /** Editor body size in px; headings and inline elements scale with it (em units). */
    fontSize: number
    font: EditorFont
    /** Max width of the text column in px, or null for the full editor width. */
    lineWidth: number | null
}

export const DEFAULT_TYPOGRAPHY: Typography = {fontSize: 16, font: 'sans', lineWidth: null}

export const FONT_SIZE_MIN = 12
export const FONT_SIZE_MAX = 28
export const LINE_WIDTH_MIN = 480
export const LINE_WIDTH_MAX = 1400
/** Width used when the readable line width is first turned on. */
export const LINE_WIDTH_DEFAULT = 760

export const FONT_STACKS: Record<EditorFont, string> = {
    sans: '"Nunito", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Helvetica Neue", sans-serif',
    serif: 'Charter, "Iowan Old Style", Georgia, Cambria, "Times New Roman", serif',
    mono: 'ui-monospace, SFMono-Regular, "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace',
    system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** Turns stored/untrusted data into valid settings, falling back to defaults. */
export function normalizeTypography(value: unknown): Typography {
    const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    const size = typeof v.fontSize === 'number' && Number.isFinite(v.fontSize) ? Math.round(v.fontSize) : DEFAULT_TYPOGRAPHY.fontSize
    const font = typeof v.font === 'string' && v.font in FONT_STACKS ? (v.font as EditorFont) : DEFAULT_TYPOGRAPHY.font
    const width =
        typeof v.lineWidth === 'number' && Number.isFinite(v.lineWidth)
            ? clamp(Math.round(v.lineWidth), LINE_WIDTH_MIN, LINE_WIDTH_MAX)
            : null
    return {fontSize: clamp(size, FONT_SIZE_MIN, FONT_SIZE_MAX), font, lineWidth: width}
}

/** Zoom: +1 / -1 changes the font size by 1px within bounds; 0 resets it. */
export function zoomTypography(t: Typography, step: -1 | 0 | 1): Typography {
    const fontSize = step === 0 ? DEFAULT_TYPOGRAPHY.fontSize : clamp(t.fontSize + step, FONT_SIZE_MIN, FONT_SIZE_MAX)
    return fontSize === t.fontSize ? t : {...t, fontSize}
}

/** The zoom level shown to the user, relative to the default size. */
export function zoomPercent(t: Typography): number {
    return Math.round((t.fontSize / DEFAULT_TYPOGRAPHY.fontSize) * 100)
}

/** CSS custom properties consumed by style.css (`.cm-editor`, `.cm-content`, title). */
export function typographyCssVars(t: Typography): Record<string, string> {
    return {
        '--editor-font-size': `${t.fontSize}px`,
        '--editor-font-family': FONT_STACKS[t.font],
        '--editor-line-width': t.lineWidth === null ? 'none' : `${t.lineWidth}px`,
    }
}

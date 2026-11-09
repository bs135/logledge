// Outline (table of contents) helpers for the right panel.

export interface OutlineItem {
    /** 1-6. */
    level: number
    /** Heading text with inline Markdown removed. */
    text: string
    /** Document position where the heading line starts. */
    from: number
}

/**
 * Heading text as shown in the outline: links reduced to their text, emphasis / code /
 * strike markers removed, escapes resolved. "## **Setup** [[Guide|the guide]]" → "Setup the guide".
 */
export function plainHeadingText(raw: string): string {
    return raw
        .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
        .replace(/\[\[([^\]]*)\]\]/g, '$1')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__|~~|`)/g, '')
        .replace(/(^|[^\\\w])[*_]([^*_]+)[*_](?!\w)/g, '$1$2')
        .replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim()
}

/** Index of the heading whose section contains `pos` (the last one starting at or before it), or -1. */
export function activeHeadingIndex(items: OutlineItem[], pos: number): number {
    let lo = 0
    let hi = items.length - 1
    let found = -1
    while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (items[mid].from <= pos) {
            found = mid
            lo = mid + 1
        } else {
            hi = mid - 1
        }
    }
    return found
}

/** Indentation step of each item relative to the shallowest heading in the note (0-based). */
export function outlineIndents(items: OutlineItem[]): number[] {
    const min = items.reduce((m, i) => Math.min(m, i.level), 6)
    return items.map((i) => i.level - min)
}

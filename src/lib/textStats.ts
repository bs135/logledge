// Word/character counts and reading time for the editor status bar.

export interface TextStats {
    words: number
    /** Characters excluding line breaks (counted as Unicode code points, so emoji count once). */
    chars: number
}

/** Average silent reading speed used for the reading-time estimate. */
export const WORDS_PER_MINUTE = 200

// A word is a run of letters/digits, optionally joined by an apostrophe or hyphen
// ("don't", "real-time"). Markdown markers (#, *, -, >, |, `) are not letters, so they
// don't count on their own.
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’-][\p{L}\p{M}\p{N}]+)*/gu
// Link and image destinations: "](https://...)" — the URL is not prose.
const LINK_DEST = /\]\([^)\s]*(?:\s+"[^"]*")?\)/g

export function textStats(text: string): TextStats {
    const prose = text.replace(LINK_DEST, ']')
    const words = prose.match(WORD)?.length ?? 0
    let chars = 0
    for (const ch of text) if (ch !== '\n' && ch !== '\r') chars++
    return {words, chars}
}

/** Reading time in whole minutes; 0 for an empty text, at least 1 otherwise. */
export function readingMinutes(words: number, wpm = WORDS_PER_MINUTE): number {
    return words === 0 ? 0 : Math.max(1, Math.round(words / wpm))
}

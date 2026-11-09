// Types and helpers for Global Search's exact mode (case-sensitive / regex / replace),
// backed by the `grep_notes` and `replace_in_notes` commands (src-tauri/src/grep.rs).

export interface LineMatch {
    /** 1-based line number. */
    line: number
    text: string
    /** [start, end) offsets into `text`, in UTF-16 units (JS string indexes). */
    ranges: [number, number][]
}

export interface FileMatches {
    path: string
    lines: LineMatch[]
    /** Matches in the note (may exceed what `lines` shows). */
    total: number
}

export interface GrepResult {
    files: FileMatches[]
    truncated: boolean
}

export interface ReplaceOutcome {
    path: string
    replaced: number
    skipped: boolean
}

/** Splits a line into plain and matched parts for highlighting. */
export function lineParts(text: string, ranges: [number, number][]): {text: string; match: boolean}[] {
    const parts: {text: string; match: boolean}[] = []
    let pos = 0
    for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
        if (start < pos || end <= start) continue
        if (start > pos) parts.push({text: text.slice(pos, start), match: false})
        parts.push({text: text.slice(start, end), match: true})
        pos = end
    }
    if (pos < text.length) parts.push({text: text.slice(pos), match: false})
    return parts
}

/** Totals for the replace confirmation: matches and notes among the selected files. */
export function replaceTotals(files: FileMatches[], excluded: Set<string>): {matches: number; notes: number} {
    let matches = 0
    let notes = 0
    for (const f of files) {
        if (excluded.has(f.path)) continue
        matches += f.total
        notes++
    }
    return {matches, notes}
}

// Back/Forward history of opened notes, as an immutable value so React state updates and
// unit tests stay simple. Paths are vault-relative with "/" separators.

export interface NavHistory {
    entries: string[]
    /** Index of the current entry; -1 when empty. */
    index: number
}

export const MAX_HISTORY = 100

export const emptyHistory: NavHistory = {entries: [], index: -1}

/** Records opening `path`: drops forward entries, ignores re-opening the current note. */
export function pushHistory(h: NavHistory, path: string): NavHistory {
    if (h.index >= 0 && h.entries[h.index] === path) return h
    const entries = [...h.entries.slice(0, h.index + 1), path]
    const overflow = Math.max(0, entries.length - MAX_HISTORY)
    return {entries: entries.slice(overflow), index: entries.length - 1 - overflow}
}

export function canGoBack(h: NavHistory): boolean {
    return h.index > 0
}

export function canGoForward(h: NavHistory): boolean {
    return h.index >= 0 && h.index < h.entries.length - 1
}

/** Moves by `step` (-1 back, +1 forward). Returns null when there is nowhere to go. */
export function stepHistory(h: NavHistory, step: -1 | 1): {history: NavHistory; path: string} | null {
    const index = h.index + step
    if (index < 0 || index >= h.entries.length) return null
    return {history: {...h, index}, path: h.entries[index]}
}

function isAffected(path: string, target: string): boolean {
    return path === target || path.startsWith(target + '/')
}

// Merges runs of the same path (e.g. A, B, A after B is removed) and keeps `index` on the
// same logical entry.
function collapse(entries: string[], index: number): NavHistory {
    const out: string[] = []
    let newIndex = -1
    entries.forEach((p, i) => {
        if (out.length === 0 || out[out.length - 1] !== p) out.push(p)
        if (i === index) newIndex = out.length - 1
    })
    return {entries: out, index: out.length ? Math.max(0, newIndex) : -1}
}

/** Follows a rename or move of a note or folder (`from` → `to`). */
export function renameInHistory(h: NavHistory, from: string, to: string): NavHistory {
    if (!h.entries.some((p) => isAffected(p, from))) return h
    const entries = h.entries.map((p) => (isAffected(p, from) ? to + p.slice(from.length) : p))
    return collapse(entries, h.index)
}

/**
 * Drops entries for a deleted note or folder, or for every path the predicate matches. The
 * current position moves to the nearest surviving entry before it (or after it).
 */
export function removeFromHistory(h: NavHistory, removed: string | ((path: string) => boolean)): NavHistory {
    const gone = typeof removed === 'string' ? (p: string) => isAffected(p, removed) : removed
    if (!h.entries.some(gone)) return h
    const kept: string[] = []
    let index = -1
    h.entries.forEach((p, i) => {
        if (gone(p)) return
        kept.push(p)
        if (i <= h.index) index = kept.length - 1
    })
    if (index < 0 && kept.length) index = 0
    return collapse(kept, index)
}

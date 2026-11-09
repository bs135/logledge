// Recent and pinned note lists (vault-relative paths with "/" separators), as immutable
// arrays so React state updates and unit tests stay simple.

/** How many recently opened notes are remembered. */
export const MAX_RECENT = 30
/** How many recent notes the Quick Switcher shows with an empty query. */
export const SWITCHER_RECENT = 10

function isAffected(path: string, target: string): boolean {
    return path === target || path.startsWith(target + '/')
}

function dedupe(list: string[]): string[] {
    return list.filter((p, i) => list.indexOf(p) === i)
}

/** Moves `path` to the front of the recent list. */
export function addRecent(list: string[], path: string, max = MAX_RECENT): string[] {
    if (list[0] === path) return list
    return [path, ...list.filter((p) => p !== path)].slice(0, max)
}

/** Pins `path` (appended at the end) or unpins it. */
export function togglePin(list: string[], path: string): string[] {
    return list.includes(path) ? list.filter((p) => p !== path) : [...list, path]
}

/** Follows a rename or move of a note or folder (`from` → `to`). */
export function renameInList(list: string[], from: string, to: string): string[] {
    if (!list.some((p) => isAffected(p, from))) return list
    return dedupe(list.map((p) => (isAffected(p, from) ? to + p.slice(from.length) : p)))
}

/** Drops a deleted note or folder, or every path the predicate matches. */
export function removeFromList(list: string[], removed: string | ((path: string) => boolean)): string[] {
    const gone = typeof removed === 'string' ? (p: string) => isAffected(p, removed) : removed
    return list.some(gone) ? list.filter((p) => !gone(p)) : list
}

/**
 * What the Quick Switcher lists with an empty query: pinned notes in pin order, then the
 * most recent notes that are not pinned and not the note already open. Notes missing
 * from `existing` (deleted outside the app) are left out.
 */
export function switcherSections(
    pinned: string[],
    recent: string[],
    existing: Set<string>,
    current: string | null,
    recentLimit = SWITCHER_RECENT,
): {pinned: string[]; recent: string[]} {
    const pins = pinned.filter((p) => existing.has(p))
    const pinSet = new Set(pins)
    const rec = recent.filter((p) => existing.has(p) && !pinSet.has(p) && p !== current).slice(0, recentLimit)
    return {pinned: pins, recent: rec}
}

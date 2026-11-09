// File-tree sort order: by name, modification or creation time, either direction, with
// folders optionally kept above files. Applied to the tree on the frontend; the backend
// returns its own fixed order (folders first, then name).

export type TreeSortBy = 'name' | 'modified' | 'created'
export type TreeSortDirection = 'asc' | 'desc'

export interface TreeSort {
    by: TreeSortBy
    direction: TreeSortDirection
    foldersFirst: boolean
}

/** The order the tree had before sorting options existed. */
export const DEFAULT_TREE_SORT: TreeSort = {by: 'name', direction: 'asc', foldersFirst: true}

export interface SortableNode {
    name: string
    path: string
    isDir: boolean
    children?: SortableNode[]
    /** Milliseconds since the Unix epoch. */
    modified?: number
    created?: number
}

export function normalizeTreeSort(value: unknown): TreeSort {
    const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    const by = v.by === 'modified' || v.by === 'created' ? v.by : 'name'
    const direction = v.direction === 'desc' ? 'desc' : v.direction === 'asc' ? 'asc' : by === 'name' ? 'asc' : 'desc'
    const foldersFirst = typeof v.foldersFirst === 'boolean' ? v.foldersFirst : true
    return {by, direction, foldersFirst}
}

const collator = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'})

/** Natural, case-insensitive name order ("note 2" before "note 10"). */
export function compareNames(a: string, b: string): number {
    return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}

/**
 * Sort keys for a node. A folder's modification time is that of the most recently
 * modified file inside it (at any depth), so "recently modified" surfaces the folders
 * you were just working in; an empty folder falls back to its own time.
 */
function timeKey(node: SortableNode, by: 'modified' | 'created', cache: Map<SortableNode, number | undefined>): number | undefined {
    if (cache.has(node)) return cache.get(node)
    let key: number | undefined
    if (!node.isDir) {
        key = by === 'created' ? node.created ?? node.modified : node.modified
    } else if (by === 'created') {
        key = node.created ?? node.modified
    } else {
        for (const child of node.children ?? []) {
            const k = timeKey(child, by, cache)
            if (k !== undefined && (key === undefined || k > key)) key = k
        }
        key ??= node.modified
    }
    cache.set(node, key)
    return key
}

/** Returns a sorted copy of the tree (nodes are copied, other fields kept). */
export function sortTree<T extends SortableNode>(root: T, sort: TreeSort): T {
    const cache = new Map<SortableNode, number | undefined>()
    const sign = sort.direction === 'asc' ? 1 : -1

    const compare = (a: SortableNode, b: SortableNode): number => {
        if (sort.foldersFirst && a.isDir !== b.isDir) return a.isDir ? -1 : 1
        if (sort.by !== 'name') {
            const ka = timeKey(a, sort.by, cache)
            const kb = timeKey(b, sort.by, cache)
            // Entries without a time go last whatever the direction.
            if (ka === undefined || kb === undefined) {
                if (ka !== kb) return ka === undefined ? 1 : -1
            } else if (ka !== kb) {
                return (ka - kb) * sign
            }
            return compareNames(a.name, b.name)
        }
        return compareNames(a.name, b.name) * sign
    }

    const visit = (node: SortableNode): SortableNode => {
        if (!node.isDir || !node.children) return node
        const children = node.children.map(visit).sort(compare)
        return {...node, children}
    }
    return visit(root) as T
}

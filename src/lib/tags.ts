// Tag rules for the editor (highlighting) and the Tags panel. Mirrors the indexer in
// src-tauri/src/tags.rs; keep the two in sync (both have the same test cases).

export interface TagMatch {
    /** Offset of "#" within the searched text. */
    from: number
    /** Offset just after the tag. */
    to: number
    /** Normalized (lower-case) tag, without "#". */
    tag: string
}

function isTagChar(c: string): boolean {
    return /[\p{L}\p{M}\p{N}_\-/]/u.test(c)
}

function mayPrecedeTag(c: string): boolean {
    return /\s/.test(c) || c === '(' || c === ',' || c === ';'
}

/** Cleans a candidate tag; null when it is not a valid tag. */
export function normalizeTag(raw: string): string | null {
    const tag = raw.trim().replace(/^#+/, '').replace(/\/+$/, '')
    if (!tag || tag.startsWith('/') || tag.includes('//') || ![...tag].every(isTagChar)) return null
    // At least one character that is not a digit: "#123" is not a tag.
    if (/^[0-9\-/]+$/.test(tag)) return null
    return tag.toLowerCase()
}

/**
 * `#tags` in a piece of text (one line; code must already be excluded by the caller).
 * A tag starts at "#" at the line start or after whitespace, "(", "," or ";" — so
 * "a#b", URLs, "](#anchor)" and "\#escaped" are not tags.
 */
export function findInlineTags(text: string): TagMatch[] {
    const chars = [...text]
    // Offsets in UTF-16 units, matching CodeMirror document positions.
    const offsets: number[] = []
    let acc = 0
    for (const ch of chars) {
        offsets.push(acc)
        acc += ch.length
    }
    offsets.push(acc)

    const out: TagMatch[] = []
    let i = 0
    while (i < chars.length) {
        if (chars[i] !== '#') {
            i++
            continue
        }
        const prev = i === 0 ? null : chars[i - 1]
        const afterLink = i >= 2 && chars[i - 2] === ']' && chars[i - 1] === '('
        let end = i + 1
        while (end < chars.length && isTagChar(chars[end])) end++
        if ((prev === null || mayPrecedeTag(prev)) && !afterLink && end > i + 1) {
            // Trailing "/" is not part of the tag.
            let tagEnd = end
            while (tagEnd > i + 1 && chars[tagEnd - 1] === '/') tagEnd--
            const tag = normalizeTag(chars.slice(i + 1, tagEnd).join(''))
            if (tag) out.push({from: offsets[i], to: offsets[tagEnd], tag})
        }
        i = Math.max(end, i + 1)
    }
    return out
}

/** Length of the YAML front matter block at the start of `doc` (0 when none). */
export function frontMatterLength(doc: string): number {
    const firstEnd = doc.indexOf('\n')
    if (firstEnd < 0 || doc.slice(0, firstEnd).trimEnd() !== '---') return 0
    let pos = firstEnd + 1
    while (pos < doc.length) {
        const next = doc.indexOf('\n', pos)
        const lineEnd = next < 0 ? doc.length : next
        const line = doc.slice(pos, lineEnd).trimEnd()
        if (line === '---' || line === '...') return lineEnd
        if (next < 0) break
        pos = next + 1
    }
    return 0
}

export interface TagCount {
    tag: string
    count: number
}

export interface TagNode {
    /** Last path segment ("q3" for "work/q3"). */
    name: string
    /** Full tag ("work/q3"). */
    tag: string
    /** Notes with exactly this tag; 0 for a parent that only exists through children. */
    count: number
    children: TagNode[]
}

/** Nests "a/b" tags under "a", sorted by name at every level. */
export function buildTagTree(counts: TagCount[]): TagNode[] {
    const root: TagNode = {name: '', tag: '', count: 0, children: []}
    for (const {tag, count} of counts) {
        let node = root
        const parts = tag.split('/')
        parts.forEach((part, i) => {
            const full = parts.slice(0, i + 1).join('/')
            let child = node.children.find((c) => c.name === part)
            if (!child) {
                child = {name: part, tag: full, count: 0, children: []}
                node.children.push(child)
            }
            if (i === parts.length - 1) child.count += count
            node = child
        })
    }
    const sort = (nodes: TagNode[]) => {
        nodes.sort((a, b) => a.name.localeCompare(b.name))
        nodes.forEach((n) => sort(n.children))
    }
    sort(root.children)
    return root.children
}

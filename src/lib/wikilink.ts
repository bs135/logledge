// Pure helpers for WikiLinks ([[Target#Heading|Alias]]): parsing, resolving a target to a
// note path in the vault, and choosing where a missing note should be created.
// Paths are vault-relative and use "/" separators.

export interface WikiLink {
    /** Note part, e.g. "folder/Note" — empty for a same-note link like [[#Heading]]. */
    target: string
    /** Heading after "#", if any. */
    heading: string | null
    /** Text after "|", if any. */
    alias: string | null
}

const NOTE_EXTENSIONS = ['.md', '.markdown']

/** Parses the text between "[[" and "]]". */
export function parseWikiLink(raw: string): WikiLink {
    let rest = raw
    let alias: string | null = null
    const pipe = rest.indexOf('|')
    if (pipe >= 0) {
        alias = rest.slice(pipe + 1).trim() || null
        rest = rest.slice(0, pipe)
    }
    let heading: string | null = null
    const hash = rest.indexOf('#')
    if (hash >= 0) {
        heading = rest.slice(hash + 1).trim() || null
        rest = rest.slice(0, hash)
    }
    const target = rest.trim().replace(/\\/g, '/').replace(/^\/+/, '')
    return {target, heading, alias}
}

/** Text shown for a link when its syntax is hidden. */
export function wikiLinkLabel(raw: string): string {
    return parseWikiLink(raw).alias ?? raw.split('|')[0].trim()
}

function stripNoteExt(name: string): string {
    const lower = name.toLowerCase()
    for (const ext of NOTE_EXTENSIONS) {
        if (lower.endsWith(ext)) return name.slice(0, -ext.length)
    }
    return name
}

function hasExtension(name: string): boolean {
    const base = name.split('/').pop() || ''
    return base.includes('.')
}

function dirOf(path: string): string {
    const i = path.lastIndexOf('/')
    return i < 0 ? '' : path.slice(0, i)
}

/**
 * Resolves a link target to one of `paths` (all files in the vault).
 * Order: exact vault-relative path, then basename match — preferring the current note's
 * folder, then the shortest path. Matching is case-insensitive. Markdown notes are
 * tried first (so "v1.2 notes" finds "v1.2 notes.md"); only then does a target with an
 * extension match any file by its full name (e.g. "diagram.png").
 */
export function resolveWikiLink(target: string, paths: string[], currentPath: string | null): string | null {
    const t = target.trim().replace(/\\/g, '/').replace(/^\/+/, '')
    if (!t) return null
    const asNote = pickCandidate(stripNoteExt(t).toLowerCase(), paths, currentPath, (p) => {
        const stripped = stripNoteExt(p)
        return stripped === p ? null : stripped.toLowerCase()
    })
    if (asNote || !hasExtension(t)) return asNote
    return pickCandidate(t.toLowerCase(), paths, currentPath, (p) => p.toLowerCase())
}

function pickCandidate(
    key: string,
    paths: string[],
    currentPath: string | null,
    normalize: (p: string) => string | null,
): string | null {
    const candidates = paths.filter((p) => {
        const n = normalize(p)
        return n !== null && (n === key || n.endsWith('/' + key))
    })
    if (candidates.length === 0) return null

    // A target with a folder part is a vault-relative path: an exact match wins outright.
    if (key.includes('/')) {
        const exact = candidates.find((p) => normalize(p) === key)
        if (exact) return exact
    }

    const currentDir = currentPath ? dirOf(currentPath) : ''
    const sameFolder = candidates.find((p) => dirOf(p) === currentDir)
    if (sameFolder) return sameFolder
    return [...candidates].sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length)[0]
}

/**
 * Where to create a note for an unresolved link: a target with "/" is relative to the
 * vault root, a bare name goes next to the current note.
 */
export function newNoteLocation(target: string, currentPath: string | null): {parent: string; name: string} {
    const t = target.trim().replace(/\\/g, '/').replace(/^\/+/, '')
    const sanitize = (s: string) => s.replace(/[<>:"\\|?*]/g, '_').trim()
    // Always a Markdown note, so "v1.2 notes" becomes "v1.2 notes.md" rather than a ".2 notes" file.
    const withExt = (n: string) => (NOTE_EXTENSIONS.some((e) => n.toLowerCase().endsWith(e)) ? n : n + '.md')
    if (t.includes('/')) {
        const parts = t.split('/').map(sanitize).filter(Boolean)
        const name = parts.pop() || 'Untitled'
        return {parent: parts.join('/'), name: withExt(name)}
    }
    return {parent: currentPath ? dirOf(currentPath) : '', name: withExt(sanitize(t) || 'Untitled')}
}

/** Collects every file path from a vault tree. */
export function collectFilePaths(node: {path: string; isDir: boolean; children?: unknown[]} | null): string[] {
    const out: string[] = []
    const walk = (n: {path: string; isDir: boolean; children?: unknown[]}) => {
        if (!n.isDir) {
            out.push(n.path)
            return
        }
        for (const c of (n.children || []) as {path: string; isDir: boolean; children?: unknown[]}[]) walk(c)
    }
    if (node) walk(node)
    return out
}

/**
 * Returns the 1-based line number of the first ATX heading whose text matches `heading`
 * (case-insensitive, ignoring closing #s), skipping fenced code blocks; null if none.
 */
export function findHeadingLine(doc: string, heading: string): number | null {
    const want = heading.trim().toLowerCase()
    const lines = doc.split('\n')
    let inFence = false
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*(```|~~~)/.test(lines[i])) {
            inFence = !inFence
            continue
        }
        if (inFence) continue
        const m = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/.exec(lines[i])
        if (m && m[1].trim().toLowerCase() === want) return i + 1
    }
    return null
}

// Backlinks: which notes link to the open note. The backend returns every link whose
// target has the open note's file name (LinkRef); this module resolves each one with
// the same rules as Ctrl+Click (wikilink.ts) and keeps those that really point here.

import {resolveWikiLink} from './wikilink'

export interface LinkRef {
    /** Note containing the link (vault-relative path). */
    source: string
    /** Target as written: "Note" / "dir/Note" for wiki links, a relative path for Markdown links. */
    target: string
    kind: 'wiki' | 'markdown'
    /** 1-based line of the link in `source`. */
    line: number
    /** That line, trimmed. */
    context: string
}

export interface BacklinkGroup {
    source: string
    mentions: {line: number; context: string}[]
}

function dirOf(path: string): string {
    const i = path.lastIndexOf('/')
    return i < 0 ? '' : path.slice(0, i)
}

/** Joins a relative path to a folder, resolving "." and "..". Null if it escapes the vault. */
export function joinRelative(dir: string, rel: string): string | null {
    const parts = rel.startsWith('/') ? [] : dir.split('/').filter(Boolean)
    for (const seg of rel.split('/')) {
        if (seg === '' || seg === '.') continue
        if (seg === '..') {
            if (parts.length === 0) return null
            parts.pop()
        } else {
            parts.push(seg)
        }
    }
    return parts.join('/')
}

/** The note a link points at, or null when it resolves to nothing in the vault. */
export function resolveLinkRef(ref: LinkRef, notePaths: string[]): string | null {
    if (ref.kind === 'wiki') return resolveWikiLink(ref.target, notePaths, ref.source)
    const joined = joinRelative(dirOf(ref.source), ref.target)
    if (joined === null) return null
    if (notePaths.includes(joined)) return joined
    // File systems on Windows/macOS are usually case-insensitive.
    const lower = joined.toLowerCase()
    return notePaths.find((p) => p.toLowerCase() === lower) ?? null
}

/**
 * Links that resolve to `current`, grouped by source note (sorted by path), each group's
 * mentions by line. Links from the note to itself are left out.
 */
export function groupBacklinks(refs: LinkRef[], current: string, notePaths: string[]): BacklinkGroup[] {
    const groups = new Map<string, BacklinkGroup>()
    for (const ref of refs) {
        if (ref.source === current || resolveLinkRef(ref, notePaths) !== current) continue
        let group = groups.get(ref.source)
        if (!group) {
            group = {source: ref.source, mentions: []}
            groups.set(ref.source, group)
        }
        // Several links on one line show the line once.
        if (!group.mentions.some((m) => m.line === ref.line)) group.mentions.push({line: ref.line, context: ref.context})
    }
    for (const g of groups.values()) g.mentions.sort((a, b) => a.line - b.line)
    return [...groups.values()].sort((a, b) => a.source.localeCompare(b.source))
}

/** Splits a search snippet ("a **match** b") into plain and highlighted parts. */
export function snippetParts(snippet: string): {text: string; match: boolean}[] {
    return snippet
        .split('**')
        .map((text, i) => ({text, match: i % 2 === 1}))
        .filter((p) => p.text !== '')
}

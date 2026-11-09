import {useCallback, useEffect, useRef, useState} from 'react'

export interface NoteLists {
    pinned: string[]
    recent: string[]
}

const EMPTY: NoteLists = {pinned: [], recent: []}

function storageKey(vaultPath: string): string {
    return `logledge:noteLists:${vaultPath}`
}

function load(vaultPath: string | null): NoteLists {
    if (!vaultPath) return EMPTY
    try {
        const raw = localStorage.getItem(storageKey(vaultPath))
        if (!raw) return EMPTY
        const parsed = JSON.parse(raw)
        const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
        return {pinned: strings(parsed?.pinned), recent: strings(parsed?.recent)}
    } catch {
        return EMPTY
    }
}

// useNoteLists keeps the pinned and recently opened notes of the active vault, stored per
// vault in localStorage (like the sidebar width) so they survive restarts. Paths are
// vault-relative, so the lists stay valid if the vault is synced to another machine.
export function useNoteLists(vaultPath: string | null) {
    const [lists, setLists] = useState<NoteLists>(() => load(vaultPath))
    const loadedFor = useRef(vaultPath)

    // Reload when switching vaults (before the save effect below can write the old lists
    // under the new vault's key).
    if (loadedFor.current !== vaultPath) {
        loadedFor.current = vaultPath
        setLists(load(vaultPath))
    }

    useEffect(() => {
        if (!vaultPath) return
        try {
            localStorage.setItem(storageKey(vaultPath), JSON.stringify(lists))
        } catch {
            // Storage full or unavailable: the lists just won't persist.
        }
    }, [vaultPath, lists])

    const update = useCallback((fn: (l: NoteLists) => NoteLists) => setLists((l) => fn(l)), [])
    return {lists, update}
}

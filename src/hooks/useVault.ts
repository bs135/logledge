import {useCallback, useEffect, useState} from 'react'
import {
    createFile as apiCreateFile,
    copyEntry,
    createFolder as apiCreateFolder,
    deleteEntry,
    duplicateEntry,
    getTree,
    initVault,
    moveEntry,
    renameEntry,
    onEvent,
    selectVaultFolder,
} from '../lib/api'
import type {VaultNode} from '../lib/types'

export interface UseVaultResult {
    vaultPath: string | null
    tree: VaultNode | null
    loading: boolean
    error: string | null
    selectFolder: () => Promise<void>
    reload: () => Promise<void>
    createFile: (parentRelPath: string, name: string) => Promise<string | undefined>
    createFolder: (parentRelPath: string, name: string) => Promise<string | undefined>
    rename: (relPath: string, newName: string) => Promise<string | undefined>
    move: (srcRelPath: string, destParentRelPath: string) => Promise<void>
    remove: (relPath: string) => Promise<void>
    duplicate: (relPath: string) => Promise<string>
    copyTo: (srcRelPath: string, destParentRelPath: string) => Promise<string>
    moveTo: (srcRelPath: string, destParentRelPath: string) => Promise<string>
}

// useVault manages all state for the active Vault: directory path, file tree,
// and CRUD operations. Does not block cold start — getTree is invoked asynchronously
// after the component mounts, allowing parent UI to render immediately while waiting.
export function useVault(): UseVaultResult {
    const [vaultPath, setVaultPath] = useState<string | null>(null)
    const [tree, setTree] = useState<VaultNode | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const refresh = useCallback(() => {
        getTree()
            .then(setTree)
            .catch((err) => setError(String(err)))
    }, [])

    useEffect(() => {
        let cancelled = false
        initVault()
            .then((path) => {
                if (cancelled) return
                setVaultPath(path || null)
                if (path) refresh()
            })
            .catch((err) => !cancelled && setError(String(err)))
            .finally(() => !cancelled && setLoading(false))
        return () => {
            cancelled = true
        }
    }, [refresh])

    useEffect(() => {
        const off = onEvent('vault:changed', refresh)
        return off
    }, [refresh])

    const selectFolder = useCallback(async () => {
        setError(null)
        try {
            const path = await selectVaultFolder()
            if (path) {
                setVaultPath(path)
                refresh()
            }
        } catch (err) {
            setError(String(err))
        }
    }, [refresh])

    const reload = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const path = await initVault()
            setVaultPath(path || null)
            if (path) {
                const tr = await getTree()
                setTree(tr)
            } else {
                setTree(null)
            }
        } catch (err) {
            setError(String(err))
        } finally {
            setLoading(false)
        }
    }, [])

    const wrap = useCallback(
        (fn: () => Promise<unknown>) => async () => {
            try {
                await fn()
                refresh()
            } catch (err) {
                setError(String(err))
            }
        },
        [refresh],
    )

    const createFile = useCallback(
        async (parentRelPath: string, name: string): Promise<string | undefined> => {
            try {
                const newPath = await apiCreateFile(parentRelPath, name)
                refresh()
                return newPath
            } catch (err) {
                setError(String(err))
                return undefined
            }
        },
        [refresh],
    )
    const createFolder = useCallback(
        async (parentRelPath: string, name: string): Promise<string | undefined> => {
            try {
                const newPath = await apiCreateFolder(parentRelPath, name)
                refresh()
                return newPath
            } catch (err) {
                setError(String(err))
                return undefined
            }
        },
        [refresh],
    )
    const rename = useCallback(
        async (relPath: string, newName: string): Promise<string | undefined> => {
            try {
                const newPath = await renameEntry(relPath, newName)
                refresh()
                return newPath
            } catch (err) {
                setError(String(err))
                throw err
            }
        },
        [refresh],
    )
    const move = useCallback(
        (srcRelPath: string, destParentRelPath: string) =>
            wrap(() => moveEntry(srcRelPath, destParentRelPath))(),
        [wrap],
    )
    const remove = useCallback((relPath: string) => wrap(() => deleteEntry(relPath))(), [wrap])
    const duplicate = useCallback(
        async (relPath: string): Promise<string> => {
            const newPath = await duplicateEntry(relPath)
            refresh()
            return newPath
        },
        [refresh],
    )
    // copyTo and moveTo back the file tree Copy/Cut + Paste actions; unlike move,
    // they return the new path and let the caller handle errors.
    const copyTo = useCallback(
        async (srcRelPath: string, destParentRelPath: string): Promise<string> => {
            const newPath = await copyEntry(srcRelPath, destParentRelPath)
            refresh()
            return newPath
        },
        [refresh],
    )
    const moveTo = useCallback(
        async (srcRelPath: string, destParentRelPath: string): Promise<string> => {
            const newPath = await moveEntry(srcRelPath, destParentRelPath)
            refresh()
            return newPath
        },
        [refresh],
    )

    return {vaultPath, tree, loading, error, selectFolder, reload, createFile, createFolder, rename, move, remove, duplicate, copyTo, moveTo}
}

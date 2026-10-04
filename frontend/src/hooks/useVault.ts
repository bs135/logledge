import {useCallback, useEffect, useState} from 'react'
import {
    CreateFile,
    CreateFolder,
    DeleteEntry,
    GetTree,
    InitVault,
    MoveEntry,
    RenameEntry,
    SelectVaultFolder,
} from '../../wailsjs/go/main/App'
import {vault} from '../../wailsjs/go/models'
import {EventsOn} from '../../wailsjs/runtime/runtime'

export interface UseVaultResult {
    vaultPath: string | null
    tree: vault.Node | null
    loading: boolean
    error: string | null
    selectFolder: () => Promise<void>
    reload: () => Promise<void>
    createFile: (parentRelPath: string, name: string) => Promise<string | undefined>
    createFolder: (parentRelPath: string, name: string) => Promise<string | undefined>
    rename: (relPath: string, newName: string) => Promise<string | undefined>
    move: (srcRelPath: string, destParentRelPath: string) => Promise<void>
    remove: (relPath: string) => Promise<void>
}

// useVault manages all state for the active Vault: directory path, file tree,
// and CRUD operations. Does not block cold start — GetTree is invoked asynchronously
// after the component mounts, allowing parent UI to render immediately while waiting.
export function useVault(): UseVaultResult {
    const [vaultPath, setVaultPath] = useState<string | null>(null)
    const [tree, setTree] = useState<vault.Node | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const refresh = useCallback(() => {
        GetTree()
            .then(setTree)
            .catch((err) => setError(String(err)))
    }, [])

    useEffect(() => {
        let cancelled = false
        InitVault()
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
        const off = EventsOn('vault:changed', refresh)
        return off
    }, [refresh])

    const selectFolder = useCallback(async () => {
        setError(null)
        try {
            const path = await SelectVaultFolder()
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
            const path = await InitVault()
            setVaultPath(path || null)
            if (path) {
                const tr = await GetTree()
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
                const newPath = await CreateFile(parentRelPath, name)
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
                const newPath = await CreateFolder(parentRelPath, name)
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
                const newPath = await RenameEntry(relPath, newName)
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
            wrap(() => MoveEntry(srcRelPath, destParentRelPath))(),
        [wrap],
    )
    const remove = useCallback((relPath: string) => wrap(() => DeleteEntry(relPath))(), [wrap])

    return {vaultPath, tree, loading, error, selectFolder, reload, createFile, createFolder, rename, move, remove}
}

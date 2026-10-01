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
    createFile: (parentRelPath: string, name: string) => Promise<void>
    createFolder: (parentRelPath: string, name: string) => Promise<void>
    rename: (relPath: string, newName: string) => Promise<void>
    move: (srcRelPath: string, destParentRelPath: string) => Promise<void>
    remove: (relPath: string) => Promise<void>
}

// useVault quản lý toàn bộ state của Vault hiện tại: đường dẫn, cây thư mục,
// và các thao tác CRUD. Không chặn cold-start — GetTree được gọi bất đồng bộ
// sau khi component mount, UI cha có thể hiển thị ngay trong lúc chờ.
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
        (parentRelPath: string, name: string) => wrap(() => CreateFile(parentRelPath, name))(),
        [wrap],
    )
    const createFolder = useCallback(
        (parentRelPath: string, name: string) => wrap(() => CreateFolder(parentRelPath, name))(),
        [wrap],
    )
    const rename = useCallback(
        (relPath: string, newName: string) => wrap(() => RenameEntry(relPath, newName))(),
        [wrap],
    )
    const move = useCallback(
        (srcRelPath: string, destParentRelPath: string) =>
            wrap(() => MoveEntry(srcRelPath, destParentRelPath))(),
        [wrap],
    )
    const remove = useCallback((relPath: string) => wrap(() => DeleteEntry(relPath))(), [wrap])

    return {vaultPath, tree, loading, error, selectFolder, createFile, createFolder, rename, move, remove}
}

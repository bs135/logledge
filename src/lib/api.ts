// Typed wrappers around the Tauri commands in src-tauri/src/commands.rs.
// Argument keys are the camelCase form of each Rust parameter name.
import {invoke} from '@tauri-apps/api/core'
import {listen} from '@tauri-apps/api/event'
import type {
    AppConfig,
    FileFilterConfig,
    SearchResult,
    SyncSettings,
    SyncStatus,
    VaultEntry,
    VaultNode,
    WriteResult,
} from './types'

// Vault list and selection

export const initVault = () => invoke<string>('init_vault')
export const pickVaultFolder = () => invoke<string>('pick_vault_folder')
export const selectVaultFolder = () => invoke<string>('select_vault_folder')
export const detectVaultInfo = (path: string) => invoke<VaultEntry>('detect_vault_info', {path})
export const saveVault = (entry: VaultEntry, makeActive: boolean) =>
    invoke<void>('save_vault', {entry, makeActive})
export const getVaultList = () => invoke<VaultEntry[]>('get_vault_list')
export const switchVault = (targetPath: string) => invoke<void>('switch_vault', {targetPath})
export const removeVault = (targetPath: string) => invoke<void>('remove_vault', {targetPath})

// App settings

export const getAppSettings = () => invoke<AppConfig>('get_app_settings')
export const saveAppSettings = (theme: string, language: string) =>
    invoke<void>('save_app_settings', {theme, language})
export const getFileFilterConfig = () => invoke<FileFilterConfig>('get_file_filter_config')
export const saveFileFilterConfig = (filter: FileFilterConfig) =>
    invoke<void>('save_file_filter_config', {filter})

// Vault files

export const getTree = () => invoke<VaultNode>('get_tree')
export const createFile = (parentRelPath: string, name: string) =>
    invoke<string>('create_file', {parentRelPath, name})
export const createFolder = (parentRelPath: string, name: string) =>
    invoke<string>('create_folder', {parentRelPath, name})
export const renameEntry = (relPath: string, newName: string) =>
    invoke<string>('rename_entry', {relPath, newName})
export const moveEntry = (srcRelPath: string, destParentRelPath: string) =>
    invoke<string>('move_entry', {srcRelPath, destParentRelPath})
export const deleteEntry = (relPath: string) => invoke<void>('delete_entry', {relPath})
export const duplicateEntry = (relPath: string) => invoke<string>('duplicate_entry', {relPath})
export const copyEntry = (srcRelPath: string, destParentRelPath: string) =>
    invoke<string>('copy_entry', {srcRelPath, destParentRelPath})
export const getAbsolutePath = (relPath: string) => invoke<string>('get_absolute_path', {relPath})
export const getNativeRelativePath = (relPath: string) =>
    invoke<string>('get_native_relative_path', {relPath})
export const revealInExplorer = (relPath: string) => invoke<void>('reveal_in_explorer', {relPath})
export const readFile = (relPath: string) => invoke<string>('read_file', {relPath})
export const writeFile = (relPath: string, content: string) =>
    invoke<void>('write_file', {relPath, content})
export const writeFileIfUnchanged = (relPath: string, content: string, expected: string) =>
    invoke<WriteResult>('write_file_if_unchanged', {relPath, content, expected})

// Attachments

export const saveAttachment = (noteRelPath: string, filename: string, base64Data: string) =>
    invoke<string>('save_attachment', {noteRelPath, filename, base64Data})
export const readAttachmentDataURL = (noteRelPath: string, imgRelPath: string) =>
    invoke<string>('read_attachment_data_url', {noteRelPath, imgRelPath})

// Search

export const searchNotes = (query: string) => invoke<SearchResult[]>('search_notes', {query})
export const quickSwitch = (query: string) => invoke<string[]>('quick_switch', {query})

// Git sync

export const getSyncSettings = () => invoke<SyncSettings>('get_sync_settings')
export const configureSync = (repoUrl: string, branch: string, authMethod: string) =>
    invoke<void>('configure_sync', {repoUrl, branch, authMethod})
export const setGitHubPAT = (pat: string) => invoke<void>('set_github_pat', {pat})
export const syncNow = () => invoke<void>('sync_now')
export const getSyncStatus = () => invoke<SyncStatus>('get_sync_status')

// App lifecycle

/** Quits after the backend's final sync (see src-tauri/src/lifecycle.rs). */
export const quitApp = () => invoke<void>('quit_app')

// Events

/** Backend events: `vault:changed` (no payload) and `sync:status` (SyncStatus). */
export type AppEvent = 'vault:changed' | 'sync:status'

/**
 * Subscribes to a backend event and returns a synchronous unsubscribe, so it
 * can be returned straight from a React effect. Unsubscribing before Tauri's
 * listener is registered still removes it once registration completes.
 */
export function onEvent<T = unknown>(event: AppEvent, handler: (payload: T) => void): () => void {
    let disposed = false
    const unlisten = listen<T>(event, (e) => {
        if (!disposed) handler(e.payload)
    })
    return () => {
        disposed = true
        unlisten.then((off) => off()).catch(() => {})
    }
}

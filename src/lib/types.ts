// Shapes of the values exchanged with the Rust backend (src-tauri/src).
// Field names follow the serde (camelCase) serialization of each struct.

export interface FileFilterConfig {
    enabled: boolean
    mode: string
    whitelist: string[]
    blacklist: string[]
}

export interface VaultEntry {
    path: string
    name: string
    gitRepoUrl?: string
    gitBranch?: string
    gitAuthMethod?: string
}

export interface AppConfig {
    vaultPath: string
    vaults?: VaultEntry[]
    theme?: string
    language?: string
    gitRepoUrl?: string
    gitBranch?: string
    gitAuthMethod?: string
    fileFilter: FileFilterConfig
}

export interface VaultNode {
    name: string
    path: string
    isDir: boolean
    children?: VaultNode[]
}

export interface WriteResult {
    saved: boolean
    diskContent: string
}

export interface SearchResult {
    path: string
    title: string
    snippet: string
}

export interface SyncSettings {
    repoURL: string
    branch: string
    authMethod: string
    hasPAT: boolean
}

export interface SyncStatus {
    state: string
    message: string
}

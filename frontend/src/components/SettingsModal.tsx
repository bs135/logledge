import {useEffect, useState} from 'react'
import {
    DetectVaultInfo,
    GetVaultList,
    PickVaultFolder,
    RemoveVault,
    SaveAppSettings,
    SaveVault,
    SetGitHubPAT,
    SwitchVault,
    SyncNow,
} from '../../wailsjs/go/main/App'
import {BrowserOpenURL} from '../../wailsjs/runtime/runtime'
import {config} from '../../wailsjs/go/models'
import {useI18n} from '../i18n'
import type {Language} from '../i18n'
import type {ThemeMode} from '../hooks/useTheme'
import {
    Settings,
    X,
    Home,
    Palette,
    Info,
    Trash2,
    Plus,
    FolderGit2,
    Pencil,
    RefreshCw,
    GitBranch,
} from 'lucide-react'
import {VaultModal} from './VaultModal'

interface SettingsModalProps {
    initialTab?: 'general' | 'vaults' | 'appearance' | 'about'
    currentVaultPath: string | null
    currentTheme: ThemeMode
    onSetTheme: (theme: ThemeMode) => void
    onSwitchVault: (newPath: string) => void
    onClose: () => void
}

export function SettingsModal({
    initialTab = 'general',
    currentVaultPath,
    currentTheme,
    onSetTheme,
    onSwitchVault,
    onClose,
}: SettingsModalProps) {
    const {lang, setLanguage, t} = useI18n()
    const [tab, setTab] = useState<'general' | 'vaults' | 'appearance' | 'about'>(initialTab)

    // Multi-Vault state
    const [vaults, setVaults] = useState<config.VaultEntry[]>([])
    const [vaultLoading, setVaultLoading] = useState(false)
    const [editingVault, setEditingVault] = useState<{
        mode: 'create' | 'edit'
        vault: config.VaultEntry
    } | null>(null)
    const [syncingActive, setSyncingActive] = useState(false)
    const [syncMsg, setSyncMsg] = useState<{type: 'success' | 'error'; text: string} | null>(null)

    // Load vaults list
    function refreshVaults() {
        GetVaultList()
            .then((list) => setVaults(list || []))
            .catch(() => {})
    }

    useEffect(() => {
        refreshVaults()
    }, [])

    async function handleAddVault() {
        try {
            setVaultLoading(true)
            const chosen = await PickVaultFolder()
            if (!chosen) return
            const detected = await DetectVaultInfo(chosen)
            setEditingVault({
                mode: 'create',
                vault: detected,
            })
        } catch (err) {
            alert(String(err))
        } finally {
            setVaultLoading(false)
        }
    }

    function handleEditVault(v: config.VaultEntry) {
        setEditingVault({
            mode: 'edit',
            vault: new config.VaultEntry({
                path: v.path,
                name: v.name,
                gitRepoUrl: v.gitRepoUrl,
                gitBranch: v.gitBranch,
                gitAuthMethod: v.gitAuthMethod,
            }),
        })
    }

    async function handleSaveVaultModal(entry: config.VaultEntry, pat?: string) {
        if (pat && entry.gitAuthMethod === 'pat') {
            await SetGitHubPAT(pat)
        }
        const isCreate = editingVault?.mode === 'create'
        await SaveVault(entry, isCreate)
        if (isCreate) {
            onSwitchVault(entry.path)
        }
        setEditingVault(null)
        refreshVaults()
    }

    async function handleSwitchVault(targetPath: string) {
        if (targetPath === currentVaultPath) return
        setVaultLoading(true)
        try {
            await SwitchVault(targetPath)
            onSwitchVault(targetPath)
            refreshVaults()
        } finally {
            setVaultLoading(false)
        }
    }

    async function handleRemoveVault(targetPath: string) {
        await RemoveVault(targetPath)
        refreshVaults()
    }

    async function handleSyncNow() {
        setSyncingActive(true)
        setSyncMsg(null)
        try {
            await SyncNow()
            setSyncMsg({
                type: 'success',
                text: lang === 'vi' ? 'Đã kích hoạt đồng bộ Git!' : 'Git sync triggered!',
            })
        } catch (err) {
            setSyncMsg({type: 'error', text: String(err)})
        } finally {
            setSyncingActive(false)
        }
    }

    function handleLanguageChange(newLang: Language) {
        setLanguage(newLang)
        SaveAppSettings(currentTheme, newLang).catch(() => {})
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
            <div
                className="flex h-[560px] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl text-neutral-800 dark:text-neutral-100"
            >
                {/* Header */}
                <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-5">
                    <div className="flex items-center gap-2">
                        <Settings className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
                        <h2 className="text-base font-semibold">{t('settings')}</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded p-1 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Body with Side Tabs */}
                <div className="flex min-h-0 flex-1">
                    {/* Tab List */}
                    <div className="w-48 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/40 p-3 flex flex-col gap-1 select-none">
                        <button
                            onClick={() => setTab('general')}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-left transition-colors ${
                                tab === 'general'
                                    ? 'bg-blue-600 text-white'
                                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-neutral-200'
                            }`}
                        >
                            <Home className="h-4 w-4 shrink-0" />
                            <span>{t('generalTab')}</span>
                        </button>
                        <button
                            onClick={() => setTab('vaults')}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-left transition-colors ${
                                tab === 'vaults'
                                    ? 'bg-blue-600 text-white'
                                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-neutral-200'
                            }`}
                        >
                            <FolderGit2 className="h-4 w-4 shrink-0" />
                            <span>{t('vaultsTab')}</span>
                        </button>
                        <button
                            onClick={() => setTab('appearance')}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-left transition-colors ${
                                tab === 'appearance'
                                    ? 'bg-blue-600 text-white'
                                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-neutral-200'
                            }`}
                        >
                            <Palette className="h-4 w-4 shrink-0" />
                            <span>{t('appearanceTab')}</span>
                        </button>
                        <button
                            onClick={() => setTab('about')}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-left transition-colors ${
                                tab === 'about'
                                    ? 'bg-blue-600 text-white'
                                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-neutral-200'
                            }`}
                        >
                            <Info className="h-4 w-4 shrink-0" />
                            <span>{t('aboutTab')}</span>
                        </button>
                    </div>

                    {/* Content area */}
                    <div className="flex-1 overflow-y-auto p-5 text-sm">
                        {/* TAB 1: GENERAL (Language only) */}
                        {tab === 'general' && (
                            <div className="space-y-4">
                                <div>
                                    <h3 className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t('language')}</h3>
                                    <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
                                        {lang === 'vi'
                                            ? 'Chọn ngôn ngữ giao diện hiển thị cho ứng dụng.'
                                            : 'Choose the interface display language for the application.'}
                                    </p>
                                    <div className="flex gap-3">
                                        <label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 flex-1 transition-colors ${
                                            lang === 'vi'
                                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                                                : 'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/30'
                                        }`}>
                                            <input
                                                type="radio"
                                                name="lang"
                                                checked={lang === 'vi'}
                                                onChange={() => handleLanguageChange('vi')}
                                                className="accent-blue-600"
                                            />
                                            <div className="text-xs">
                                                <div className="font-semibold text-neutral-900 dark:text-neutral-100">Tiếng Việt</div>
                                                <div className="text-neutral-500 dark:text-neutral-400">Vietnamese</div>
                                            </div>
                                        </label>

                                        <label className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 flex-1 transition-colors ${
                                            lang === 'en'
                                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                                                : 'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/30'
                                        }`}>
                                            <input
                                                type="radio"
                                                name="lang"
                                                checked={lang === 'en'}
                                                onChange={() => handleLanguageChange('en')}
                                                className="accent-blue-600"
                                            />
                                            <div className="text-xs">
                                                <div className="font-semibold text-neutral-900 dark:text-neutral-100">English</div>
                                                <div className="text-neutral-500 dark:text-neutral-400">Tiếng Anh</div>
                                            </div>
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* TAB 2: VAULT MANAGEMENT */}
                        {tab === 'vaults' && (
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t('vaultsSection')}</h3>
                                        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                                            {lang === 'vi'
                                                ? 'Quản lý các kho ghi chú và thông tin đồng bộ Git riêng cho từng Vault.'
                                                : 'Manage note vaults and individual Git synchronization settings for each vault.'}
                                        </p>
                                    </div>
                                    <button
                                        disabled={vaultLoading}
                                        onClick={handleAddVault}
                                        className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 transition-colors shrink-0"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        <span>{t('addVault')}</span>
                                    </button>
                                </div>

                                {syncMsg && (
                                    <div
                                        className={`rounded-lg p-2.5 text-xs ${
                                            syncMsg.type === 'success'
                                                ? 'bg-green-100 border border-green-300 text-green-800 dark:bg-green-950/60 dark:border-green-600/40 dark:text-green-300'
                                                : 'bg-red-100 border border-red-300 text-red-800 dark:bg-red-950/60 dark:border-red-600/40 dark:text-red-300'
                                        }`}
                                    >
                                        {syncMsg.text}
                                    </div>
                                )}

                                <div className="space-y-2 pt-1">
                                    {vaults.map((v) => {
                                        const isActive = v.path === currentVaultPath
                                        return (
                                            <div
                                                key={v.path}
                                                className={`flex items-center justify-between rounded-lg border p-3 ${
                                                    isActive
                                                        ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/20'
                                                        : 'border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-800/40'
                                                }`}
                                            >
                                                <div className="min-w-0 pr-2 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-semibold text-neutral-900 dark:text-neutral-100">{v.name}</span>
                                                        {isActive && (
                                                            <span className="rounded bg-blue-100 dark:bg-blue-600/30 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-400">
                                                                {t('active')}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="truncate text-xs text-neutral-500 dark:text-neutral-400 mt-0.5" title={v.path}>
                                                        {v.path}
                                                    </div>
                                                    {v.gitRepoUrl ? (
                                                        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] text-neutral-600 dark:text-neutral-400">
                                                            <span className="truncate max-w-[280px] font-mono text-[10px] text-neutral-500 dark:text-neutral-400" title={v.gitRepoUrl}>
                                                                {v.gitRepoUrl}
                                                            </span>
                                                            <span className="inline-flex items-center gap-0.5 rounded bg-neutral-200 dark:bg-neutral-700 px-1.5 py-0.5 text-[10px] font-mono">
                                                                <GitBranch className="h-2.5 w-2.5" />
                                                                <span>{v.gitBranch || 'main'}</span>
                                                            </span>
                                                            <span className="rounded bg-neutral-200 dark:bg-neutral-700 px-1.5 py-0.5 text-[10px] uppercase font-mono">
                                                                {v.gitAuthMethod || 'none'}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <div className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1 italic">
                                                            {t('noGitConfigured')}
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                                                    {isActive && v.gitRepoUrl && (
                                                        <button
                                                            disabled={syncingActive}
                                                            onClick={handleSyncNow}
                                                            title={t('syncNow')}
                                                            className="flex items-center gap-1 rounded bg-neutral-200 text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-600 px-2 py-1 text-xs font-medium transition-colors"
                                                        >
                                                            <RefreshCw className={`h-3 w-3 ${syncingActive ? 'animate-spin' : ''}`} />
                                                            <span>{t('syncNow')}</span>
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleEditVault(v)}
                                                        title={t('editVault')}
                                                        className="rounded p-1.5 text-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </button>
                                                    {!isActive && (
                                                        <>
                                                            <button
                                                                disabled={vaultLoading}
                                                                onClick={() => handleSwitchVault(v.path)}
                                                                className="rounded bg-neutral-200 text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-600 px-2.5 py-1 text-xs font-medium transition-colors"
                                                            >
                                                                {t('switchVault')}
                                                            </button>
                                                            <button
                                                                onClick={() => handleRemoveVault(v.path)}
                                                                title={t('removeVault')}
                                                                className="rounded p-1 text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )}

                        {/* TAB 3: APPEARANCE */}
                        {tab === 'appearance' && (
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t('theme')}</h3>
                                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                    {lang === 'vi'
                                        ? 'Tùy chỉnh tông màu hiển thị của toàn bộ ứng dụng và trình soạn thảo Markdown.'
                                        : 'Customize color scheme for the application shell and Markdown editor.'}
                                </p>

                                <div className="grid grid-cols-3 gap-3 pt-2">
                                    <button
                                        onClick={() => onSetTheme('dark')}
                                        className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all ${
                                            currentTheme === 'dark'
                                                ? 'border-blue-500 ring-2 ring-blue-500/20 bg-neutral-100 dark:bg-neutral-800/90'
                                                : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-800/40 dark:hover:border-neutral-700'
                                        }`}
                                    >
                                        <div className="h-14 w-full rounded-md bg-neutral-950 border border-neutral-700 flex flex-col p-1.5 gap-1 shadow-inner">
                                            <div className="h-2 w-12 rounded bg-neutral-700" />
                                            <div className="h-2 w-full rounded bg-neutral-800" />
                                            <div className="h-2 w-3/4 rounded bg-neutral-800" />
                                        </div>
                                        <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">{t('themeDark')}</span>
                                    </button>

                                    <button
                                        onClick={() => onSetTheme('light')}
                                        className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all ${
                                            currentTheme === 'light'
                                                ? 'border-blue-500 ring-2 ring-blue-500/20 bg-neutral-100 dark:bg-neutral-800/90'
                                                : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-800/40 dark:hover:border-neutral-700'
                                        }`}
                                    >
                                        <div className="h-14 w-full rounded-md bg-neutral-100 border border-neutral-300 flex flex-col p-1.5 gap-1 shadow-inner">
                                            <div className="h-2 w-12 rounded bg-blue-500" />
                                            <div className="h-2 w-full rounded bg-neutral-300" />
                                            <div className="h-2 w-3/4 rounded bg-neutral-300" />
                                        </div>
                                        <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">{t('themeLight')}</span>
                                    </button>

                                    <button
                                        onClick={() => onSetTheme('system')}
                                        className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all ${
                                            currentTheme === 'system'
                                                ? 'border-blue-500 ring-2 ring-blue-500/20 bg-neutral-100 dark:bg-neutral-800/90'
                                                : 'border-neutral-200 bg-neutral-50 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-800/40 dark:hover:border-neutral-700'
                                        }`}
                                    >
                                        <div className="h-14 w-full rounded-md border border-neutral-300 dark:border-neutral-700 overflow-hidden flex shadow-inner">
                                            <div className="w-1/2 h-full bg-neutral-950 p-1 flex flex-col gap-1">
                                                <div className="h-2 w-6 rounded bg-neutral-700" />
                                                <div className="h-2 w-full rounded bg-neutral-800" />
                                            </div>
                                            <div className="w-1/2 h-full bg-neutral-100 p-1 flex flex-col gap-1">
                                                <div className="h-2 w-6 rounded bg-blue-500" />
                                                <div className="h-2 w-full rounded bg-neutral-300" />
                                            </div>
                                        </div>
                                        <span className="text-xs font-semibold text-neutral-800 dark:text-neutral-200">{t('themeSystem')}</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* TAB 4: ABOUT & HELP */}
                        {tab === 'about' && (
                            <div className="space-y-5">
                                <div className="flex items-center gap-3">
                                    <img src="/icon.svg" alt="Logledge" className="h-10 w-10" />
                                    <div>
                                        <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">Logledge</h3>
                                        <p className="text-xs text-neutral-500 dark:text-neutral-400">v0.1.1 • Local-first Modern Desktop Note App</p>
                                    </div>
                                </div>

                                <p className="text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">
                                    {lang === 'vi'
                                        ? 'Logledge là ứng dụng ghi chép tri thức cá nhân theo triết lý local-first: dữ liệu luôn nằm trọn vẹn trong các thư mục Vault trên máy bạn dưới định dạng Markdown chuẩn, tích hợp đồng bộ Git hai chiều tự động.'
                                        : 'Logledge is a local-first desktop personal knowledge base application: your notes are saved as plain Markdown files on your disk with seamless automatic GitHub synchronization.'}
                                </p>

                                <div className="flex gap-2">
                                    <button
                                        onClick={() => BrowserOpenURL('https://github.com/bs135/logledge')}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-200 text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700 px-3 py-1.5 text-xs font-medium transition-colors"
                                    >
                                        <FolderGit2 className="h-3.5 w-3.5" />
                                        <span>GitHub Repository</span>
                                    </button>
                                </div>

                                <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                                    <h4 className="mb-2 text-xs font-semibold text-neutral-800 dark:text-neutral-200">{t('shortcuts')}</h4>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                        <div className="flex items-center justify-between rounded bg-neutral-100 dark:bg-neutral-800/40 p-2 text-neutral-700 dark:text-neutral-300">
                                            <span>Quick Switcher</span>
                                            <kbd className="rounded bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 px-1.5 py-0.5 font-mono text-[11px]">Ctrl + P</kbd>
                                        </div>
                                        <div className="flex items-center justify-between rounded bg-neutral-100 dark:bg-neutral-800/40 p-2 text-neutral-700 dark:text-neutral-300">
                                            <span>Global Search</span>
                                            <kbd className="rounded bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 px-1.5 py-0.5 font-mono text-[11px]">Ctrl + Shift + F</kbd>
                                        </div>
                                        <div className="flex items-center justify-between rounded bg-neutral-100 dark:bg-neutral-800/40 p-2 text-neutral-700 dark:text-neutral-300">
                                            <span>Toggle Sidebar</span>
                                            <kbd className="rounded bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 px-1.5 py-0.5 font-mono text-[11px]">Ctrl + B</kbd>
                                        </div>
                                        <div className="flex items-center justify-between rounded bg-neutral-100 dark:bg-neutral-800/40 p-2 text-neutral-700 dark:text-neutral-300">
                                            <span>Settings Dialog</span>
                                            <kbd className="rounded bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-300 px-1.5 py-0.5 font-mono text-[11px]">Ctrl + ,</kbd>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Sub-modal: Add / Edit Vault */}
            {editingVault && (
                <VaultModal
                    isOpen={true}
                    mode={editingVault.mode}
                    initialVault={editingVault.vault}
                    onSave={handleSaveVaultModal}
                    onClose={() => setEditingVault(null)}
                />
            )}
        </div>
    )
}

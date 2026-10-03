import {useEffect, useState} from 'react'
import {
    ConfigureSync,
    GetAppSettings,
    GetSyncSettings,
    GetVaultList,
    RemoveVault,
    SaveAppSettings,
    SelectVaultFolder,
    SetGitHubPAT,
    SwitchVault,
    SyncNow,
} from '../../wailsjs/go/main/App'
import {BrowserOpenURL} from '../../wailsjs/runtime/runtime'
import {config} from '../../wailsjs/go/models'
import {useI18n} from '../i18n'
import type {Language} from '../i18n'
import type {ThemeMode} from '../hooks/useTheme'

interface SettingsModalProps {
    initialTab?: 'general' | 'appearance' | 'sync' | 'about'
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
    const [tab, setTab] = useState<'general' | 'appearance' | 'sync' | 'about'>(initialTab)

    // Multi-Vault state
    const [vaults, setVaults] = useState<config.VaultEntry[]>([])
    const [vaultLoading, setVaultLoading] = useState(false)

    // Git Sync state
    const [repoURL, setRepoURL] = useState('')
    const [branch, setBranch] = useState('main')
    const [authMethod, setAuthMethod] = useState<'none' | 'pat' | 'ssh'>('pat')
    const [pat, setPat] = useState('')
    const [hasPAT, setHasPAT] = useState(false)
    const [syncSaving, setSyncSaving] = useState(false)
    const [syncMsg, setSyncMsg] = useState<{type: 'success' | 'error'; text: string} | null>(null)

    // Load vaults list
    function refreshVaults() {
        GetVaultList()
            .then((list) => setVaults(list || []))
            .catch(() => {})
    }

    useEffect(() => {
        refreshVaults()
        GetSyncSettings().then((s) => {
            setRepoURL(s.repoURL || '')
            setBranch(s.branch || 'main')
            if (s.authMethod === 'pat' || s.authMethod === 'ssh' || s.authMethod === 'none') {
                setAuthMethod(s.authMethod)
            }
            setHasPAT(s.hasPAT)
        })
    }, [])

    async function handleAddVault() {
        try {
            setVaultLoading(true)
            const chosen = await SelectVaultFolder()
            if (chosen) {
                onSwitchVault(chosen)
                refreshVaults()
            }
        } finally {
            setVaultLoading(false)
        }
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

    async function handleSaveSync() {
        setSyncSaving(true)
        setSyncMsg(null)
        try {
            if (authMethod === 'pat' && pat.trim()) {
                await SetGitHubPAT(pat.trim())
            }
            await ConfigureSync(repoURL.trim(), branch.trim() || 'main', authMethod)
            setSyncMsg({type: 'success', text: lang === 'vi' ? 'Đã lưu cấu hình đồng bộ thành công!' : 'Sync settings saved successfully!'})
        } catch (err) {
            setSyncMsg({type: 'error', text: String(err)})
        } finally {
            setSyncSaving(false)
        }
    }

    async function handleSyncNow() {
        setSyncSaving(true)
        setSyncMsg(null)
        try {
            await SyncNow()
            setSyncMsg({type: 'success', text: lang === 'vi' ? 'Đã kích hoạt đồng bộ Git!' : 'Git sync triggered!'})
        } catch (err) {
            setSyncMsg({type: 'error', text: String(err)})
        } finally {
            setSyncSaving(false)
        }
    }

    function handleLanguageChange(newLang: Language) {
        setLanguage(newLang)
        SaveAppSettings(currentTheme, newLang).catch(() => {})
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
            <div
                className="flex h-[560px] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl text-neutral-800 dark:text-neutral-100"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex h-12 shrink-0 items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-5">
                    <div className="flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5 text-neutral-500 dark:text-neutral-400">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                        <h2 className="text-base font-semibold">{t('settings')}</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded p-1 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
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
                            <span>🏠</span>
                            <span>{t('generalTab')}</span>
                        </button>
                        <button
                            onClick={() => setTab('appearance')}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-left transition-colors ${
                                tab === 'appearance'
                                    ? 'bg-blue-600 text-white'
                                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-neutral-200'
                            }`}
                        >
                            <span>🎨</span>
                            <span>{t('appearanceTab')}</span>
                        </button>
                        <button
                            onClick={() => setTab('sync')}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-left transition-colors ${
                                tab === 'sync'
                                    ? 'bg-blue-600 text-white'
                                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-neutral-200'
                            }`}
                        >
                            <span>🔄</span>
                            <span>{t('syncTab')}</span>
                        </button>
                        <button
                            onClick={() => setTab('about')}
                            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-left transition-colors ${
                                tab === 'about'
                                    ? 'bg-blue-600 text-white'
                                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800/60 hover:text-neutral-900 dark:hover:text-neutral-200'
                            }`}
                        >
                            <span>ℹ️</span>
                            <span>{t('aboutTab')}</span>
                        </button>
                    </div>

                    {/* Content area */}
                    <div className="flex-1 overflow-y-auto p-5 text-sm">
                        {/* TAB 1: GENERAL */}
                        {tab === 'general' && (
                            <div className="space-y-6">
                                {/* Multi-Vault Management */}
                                <div>
                                    <h3 className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t('vaultsSection')}</h3>
                                    <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
                                        {lang === 'vi'
                                            ? 'Danh sách các kho ghi chú (Vault) đã mở trên máy. Bạn có thể chuyển nhanh giữa các kho.'
                                            : 'List of vaults opened on this machine. You can quickly switch between them.'}
                                    </p>

                                    <div className="space-y-2 mb-3">
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
                                                    <div className="min-w-0 pr-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium text-neutral-900 dark:text-neutral-100">{v.name}</span>
                                                            {isActive && (
                                                                <span className="rounded bg-blue-100 dark:bg-blue-600/30 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-400">
                                                                    {lang === 'vi' ? 'Đang mở' : 'Active'}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="truncate text-xs text-neutral-500 dark:text-neutral-400" title={v.path}>
                                                            {v.path}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
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
                                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                                                                        <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                                                    </svg>
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>

                                    <button
                                        disabled={vaultLoading}
                                        onClick={handleAddVault}
                                        className="flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                                            <path d="M12 5v14M5 12h14" />
                                        </svg>
                                        <span>{t('addVault')}</span>
                                    </button>
                                </div>

                                <div className="border-t border-neutral-200 dark:border-neutral-800 pt-4">
                                    <h3 className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t('language')}</h3>
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

                        {/* TAB 2: APPEARANCE */}
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

                        {/* TAB 3: GIT SYNC */}
                        {tab === 'sync' && (
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t('syncTab')}</h3>

                                <div>
                                    <label className="mb-1 block text-xs text-neutral-600 dark:text-neutral-400">GitHub Repository URL</label>
                                    <input
                                        className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950/60 px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-600 outline-none focus:border-blue-500 transition-colors"
                                        placeholder="https://github.com/owner/notes-vault.git"
                                        value={repoURL}
                                        onChange={(e) => setRepoURL(e.target.value)}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1 block text-xs text-neutral-600 dark:text-neutral-400">{lang === 'vi' ? 'Nhánh (Branch)' : 'Branch'}</label>
                                    <input
                                        className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950/60 px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:border-blue-500 transition-colors"
                                        value={branch}
                                        onChange={(e) => setBranch(e.target.value)}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1 block text-xs text-neutral-600 dark:text-neutral-400">{lang === 'vi' ? 'Phương thức xác thực' : 'Authentication Method'}</label>
                                    <select
                                        className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950/60 px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:border-blue-500 transition-colors"
                                        value={authMethod}
                                        onChange={(e) => setAuthMethod(e.target.value as 'none' | 'pat' | 'ssh')}
                                    >
                                        <option value="pat">Personal Access Token (HTTPS)</option>
                                        <option value="ssh">SSH Key (Cấu hình SSH sẵn có của OS)</option>
                                    </select>
                                </div>

                                {authMethod === 'pat' && (
                                    <div>
                                        <label className="mb-1 block text-xs text-neutral-600 dark:text-neutral-400">
                                            Personal Access Token {hasPAT && <span className="text-green-600 dark:text-green-500">({lang === 'vi' ? 'đã lưu trong OS Keychain' : 'stored in OS Keychain'})</span>}
                                        </label>
                                        <input
                                            type="password"
                                            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950/60 px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-600 outline-none focus:border-blue-500 transition-colors"
                                            placeholder={hasPAT ? (lang === 'vi' ? 'Nhập để thay thế token hiện có…' : 'Enter to replace existing token…') : 'ghp_…'}
                                            value={pat}
                                            onChange={(e) => setPat(e.target.value)}
                                        />
                                    </div>
                                )}

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

                                <div className="flex gap-2 pt-2">
                                    <button
                                        disabled={syncSaving || !repoURL.trim()}
                                        onClick={handleSaveSync}
                                        className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
                                    >
                                        {syncSaving ? (lang === 'vi' ? 'Đang lưu…' : 'Saving…') : t('save')}
                                    </button>
                                    <button
                                        disabled={syncSaving || !repoURL.trim()}
                                        onClick={handleSyncNow}
                                        className="rounded-lg bg-neutral-200 text-neutral-800 hover:bg-neutral-300 dark:bg-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-600 px-4 py-2 text-xs font-medium transition-colors"
                                    >
                                        {lang === 'vi' ? 'Đồng bộ ngay' : 'Sync Now'}
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
                                        <p className="text-xs text-neutral-500 dark:text-neutral-400">v0.1.0-alpha • Local-first Modern Desktop Note App</p>
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
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
                                            <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                                            <path d="M9 18c-4.51 2-5-2-7-2" />
                                        </svg>
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
        </div>
    )
}

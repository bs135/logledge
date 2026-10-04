import {useEffect, useState} from 'react'
import {config} from '../../wailsjs/go/models'
import {GetSyncSettings} from '../../wailsjs/go/main/App'
import {useI18n} from '../i18n'
import {
    Folder,
    FolderGit2,
    GitBranch,
    Key,
    Shield,
    X,
} from 'lucide-react'

interface VaultModalProps {
    isOpen: boolean
    mode: 'create' | 'edit'
    initialVault: config.VaultEntry
    onSave: (entry: config.VaultEntry, pat?: string) => Promise<void>
    onClose: () => void
}

export function VaultModal({
    isOpen,
    mode,
    initialVault,
    onSave,
    onClose,
}: VaultModalProps) {
    const {t} = useI18n()
    const [name, setName] = useState(initialVault.name || '')
    const [repoURL, setRepoURL] = useState(initialVault.gitRepoUrl || '')
    const [branch, setBranch] = useState(initialVault.gitBranch || 'main')
    const [authMethod, setAuthMethod] = useState<'none' | 'pat' | 'ssh'>(
        (initialVault.gitAuthMethod as 'none' | 'pat' | 'ssh') || (initialVault.gitRepoUrl ? 'pat' : 'none')
    )
    const [pat, setPat] = useState('')
    const [hasPAT, setHasPAT] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        setName(initialVault.name || '')
        setRepoURL(initialVault.gitRepoUrl || '')
        setBranch(initialVault.gitBranch || 'main')
        const initialAuth =
            (initialVault.gitAuthMethod as 'none' | 'pat' | 'ssh') ||
            (initialVault.gitRepoUrl ? 'pat' : 'none')
        setAuthMethod(initialAuth)
        setPat('')
        setError(null)
    }, [initialVault])

    useEffect(() => {
        GetSyncSettings()
            .then((s) => setHasPAT(s.hasPAT))
            .catch(() => {})
    }, [])

    if (!isOpen) return null

    function handleRepoURLChange(val: string) {
        setRepoURL(val)
        const trimmed = val.trim().toLowerCase()
        if (trimmed.startsWith('git@') || trimmed.startsWith('ssh://')) {
            setAuthMethod('ssh')
        } else if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
            setAuthMethod('pat')
        } else if (!trimmed) {
            setAuthMethod('none')
        } else if (authMethod === 'none') {
            setAuthMethod('pat')
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setSaving(true)
        setError(null)
        try {
            const trimmedPath = initialVault.path
            const trimmedName = name.trim() || trimmedPath.split(/[/\\]/).filter(Boolean).pop() || trimmedPath
            const trimmedURL = repoURL.trim()
            const trimmedBranch = branch.trim() || 'main'

            const entry = new config.VaultEntry({
                path: trimmedPath,
                name: trimmedName,
                gitRepoUrl: trimmedURL,
                gitBranch: trimmedBranch,
                gitAuthMethod: trimmedURL ? authMethod : 'none',
            })

            await onSave(entry, pat.trim() || undefined)
            onClose()
        } catch (err) {
            setError(String(err))
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
            <div
                className="w-full max-w-lg rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden text-neutral-800 dark:text-neutral-100"
            >
                {/* Header */}
                <div className="flex h-12 items-center justify-between border-b border-neutral-200 dark:border-neutral-800 px-5">
                    <div className="flex items-center gap-2">
                        <FolderGit2 className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        <h3 className="text-sm font-semibold">
                            {mode === 'create' ? t('addVaultModalTitle') : t('editVaultModalTitle')}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded p-1 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
                    {/* Path (read-only) */}
                    <div>
                        <label className="mb-1 block font-medium text-neutral-600 dark:text-neutral-400">
                            {t('vaultFolderPath')}
                        </label>
                        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-950/40 px-3 py-2 text-neutral-700 dark:text-neutral-300">
                            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                            <span className="truncate select-all" title={initialVault.path}>
                                {initialVault.path}
                            </span>
                        </div>
                    </div>

                    {/* Display Name */}
                    <div>
                        <label className="mb-1 block font-medium text-neutral-600 dark:text-neutral-400">
                            {t('vaultDisplayName')}
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={t('vaultDisplayNamePlaceholder')}
                            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950/60 px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-600 outline-none focus:border-blue-500 transition-colors"
                        />
                    </div>

                    {/* Repository URL */}
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="font-medium text-neutral-600 dark:text-neutral-400">
                                {t('repoURL')}
                            </label>
                            {initialVault.gitRepoUrl && (
                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                                    ✓ Auto-detected
                                </span>
                            )}
                        </div>
                        <input
                            type="text"
                            value={repoURL}
                            onChange={(e) => handleRepoURLChange(e.target.value)}
                            placeholder={t('repoURLPlaceholder')}
                            className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950/60 px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-600 outline-none focus:border-blue-500 transition-colors"
                        />
                    </div>

                    {/* Branch & Auth Method */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="mb-1 flex items-center gap-1 font-medium text-neutral-600 dark:text-neutral-400">
                                <GitBranch className="h-3 w-3" />
                                <span>{t('branch')}</span>
                            </label>
                            <input
                                type="text"
                                value={branch}
                                onChange={(e) => setBranch(e.target.value)}
                                placeholder="main"
                                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950/60 px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:border-blue-500 transition-colors"
                            />
                        </div>

                        <div>
                            <label className="mb-1 flex items-center gap-1 font-medium text-neutral-600 dark:text-neutral-400">
                                <Shield className="h-3 w-3" />
                                <span>{t('authMethod')}</span>
                            </label>
                            <select
                                value={authMethod}
                                onChange={(e) => setAuthMethod(e.target.value as 'none' | 'pat' | 'ssh')}
                                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950/60 px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:border-blue-500 transition-colors"
                            >
                                <option value="pat">{t('authPAT')}</option>
                                <option value="ssh">{t('authSSH')}</option>
                                <option value="none">{t('authNone')}</option>
                            </select>
                        </div>
                    </div>

                    {/* PAT token field (if PAT method selected) */}
                    {authMethod === 'pat' && (
                        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950/40 p-3 space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-1 font-medium text-neutral-700 dark:text-neutral-300">
                                    <Key className="h-3 w-3 text-neutral-500" />
                                    <span>{t('personalAccessToken')}</span>
                                </label>
                                {hasPAT && (
                                    <span className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                                        ✓ {t('patStoredInKeychain')}
                                    </span>
                                )}
                            </div>
                            <input
                                type="password"
                                value={pat}
                                onChange={(e) => setPat(e.target.value)}
                                placeholder={t('patPlaceholder')}
                                className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-1.5 text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-600 outline-none focus:border-blue-500 transition-colors"
                            />
                            <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
                                {t('patHint')}
                            </p>
                        </div>
                    )}

                    {error && (
                        <div className="rounded-lg bg-red-100 border border-red-300 p-2 text-xs text-red-800 dark:bg-red-950/60 dark:border-red-600/40 dark:text-red-300">
                            {error}
                        </div>
                    )}

                    {/* Footer buttons */}
                    <div className="flex justify-end gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 px-4 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
                        >
                            {t('cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
                        >
                            {saving ? t('loading') : t('saveVault')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

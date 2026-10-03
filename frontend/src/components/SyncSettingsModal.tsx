import {useEffect, useState} from 'react'
import {ConfigureSync, GetSyncSettings, SetGitHubPAT} from '../../wailsjs/go/main/App'

interface SyncSettingsModalProps {
    onClose: () => void
}

// SyncSettingsModal allows users to configure GitHub Repository (private),
// branch, authentication method (PAT or SSH), and Personal Access Token.
// PAT is never read back or displayed — it can only be newly set or replaced.
export function SyncSettingsModal({onClose}: SyncSettingsModalProps) {
    const [repoURL, setRepoURL] = useState('')
    const [branch, setBranch] = useState('main')
    const [authMethod, setAuthMethod] = useState<'none' | 'pat' | 'ssh'>('pat')
    const [pat, setPat] = useState('')
    const [hasPAT, setHasPAT] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        GetSyncSettings().then((s) => {
            setRepoURL(s.repoURL || '')
            setBranch(s.branch || 'main')
            if (s.authMethod === 'pat' || s.authMethod === 'ssh' || s.authMethod === 'none') {
                setAuthMethod(s.authMethod)
            }
            setHasPAT(s.hasPAT)
        })
    }, [])

    async function handleSave() {
        setSaving(true)
        setError(null)
        try {
            if (authMethod === 'pat' && pat.trim()) {
                await SetGitHubPAT(pat.trim())
            }
            await ConfigureSync(repoURL.trim(), branch.trim() || 'main', authMethod)
            onClose()
        } catch (err) {
            setError(String(err))
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div
                className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-800 p-5 shadow-2xl"
            >
                <h2 className="mb-4 text-lg font-semibold text-neutral-100">Cấu hình đồng bộ GitHub</h2>

                <label className="mb-1 block text-xs text-neutral-400">GitHub Repository URL</label>
                <input
                    className="mb-3 w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
                    placeholder="https://github.com/owner/repo.git"
                    value={repoURL}
                    onChange={(e) => setRepoURL(e.target.value)}
                />

                <label className="mb-1 block text-xs text-neutral-400">Nhánh</label>
                <input
                    className="mb-3 w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                />

                <label className="mb-1 block text-xs text-neutral-400">Phương thức xác thực</label>
                <select
                    className="mb-3 w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
                    value={authMethod}
                    onChange={(e) => setAuthMethod(e.target.value as 'none' | 'pat' | 'ssh')}
                >
                    <option value="pat">Personal Access Token (HTTPS)</option>
                    <option value="ssh">SSH Key (dùng cấu hình SSH sẵn có của hệ thống)</option>
                </select>

                {authMethod === 'pat' && (
                    <>
                        <label className="mb-1 block text-xs text-neutral-400">
                            Personal Access Token {hasPAT && <span className="text-green-500">(đã lưu trong OS Keychain)</span>}
                        </label>
                        <input
                            type="password"
                            className="mb-3 w-full rounded border border-neutral-600 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100 outline-none focus:border-blue-500"
                            placeholder={hasPAT ? 'Nhập để thay thế token đã lưu…' : 'ghp_…'}
                            value={pat}
                            onChange={(e) => setPat(e.target.value)}
                        />
                    </>
                )}

                {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

                <div className="flex justify-end gap-2">
                    <button className="rounded px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700" onClick={onClose}>
                        Huỷ
                    </button>
                    <button
                        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                        onClick={handleSave}
                        disabled={saving || !repoURL.trim()}
                    >
                        {saving ? 'Đang lưu…' : 'Lưu'}
                    </button>
                </div>
            </div>
        </div>
    )
}

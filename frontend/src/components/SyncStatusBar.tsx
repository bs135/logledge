import {useEffect, useState} from 'react'
import {GetSyncStatus, SyncNow} from '../../wailsjs/go/main/App'
import {gitsync} from '../../wailsjs/go/models'
import {EventsOn} from '../../wailsjs/runtime/runtime'
import {Settings, CheckCircle2, RefreshCw, AlertTriangle, WifiOff, XCircle} from 'lucide-react'

interface SyncStatusBarProps {
    onOpenSettings: () => void
}

const STATE_LABEL: Record<string, string> = {
    not_configured: 'Chưa cấu hình đồng bộ',
    idle: 'Đã đồng bộ',
    syncing: 'Đang đồng bộ…',
    conflict: 'Có xung đột',
    offline: 'Mất kết nối',
    error: 'Lỗi đồng bộ',
}

function StatusIcon({state, syncing}: {state: string; syncing: boolean}) {
    if (syncing) {
        return <RefreshCw className="h-3.5 w-3.5 text-blue-500 animate-spin" />
    }
    switch (state) {
        case 'idle':
            return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        case 'syncing':
            return <RefreshCw className="h-3.5 w-3.5 text-blue-500 animate-spin" />
        case 'conflict':
            return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        case 'offline':
            return <WifiOff className="h-3.5 w-3.5 text-neutral-400" />
        case 'error':
            return <XCircle className="h-3.5 w-3.5 text-red-500" />
        case 'not_configured':
        default:
            return <Settings className="h-3.5 w-3.5 text-neutral-500" />
    }
}

// SyncStatusBar displays GitHub sync status (Phase 4) at the bottom of the screen,
// allowing users to click to sync immediately or open settings.
export function SyncStatusBar({onOpenSettings}: SyncStatusBarProps) {
    const [status, setStatus] = useState<gitsync.Status>({state: 'not_configured', message: ''})
    const [syncing, setSyncing] = useState(false)

    useEffect(() => {
        GetSyncStatus().then(setStatus).catch(() => {})
        const off = EventsOn('sync:status', (s: gitsync.Status) => setStatus(s))
        return off
    }, [])

    async function handleClick() {
        if (status.state === 'not_configured') {
            onOpenSettings()
            return
        }
        setSyncing(true)
        try {
            await SyncNow()
        } catch {
            // Error status is already emitted via the sync:status event
        } finally {
            setSyncing(false)
        }
    }

    return (
        <div className="flex items-center justify-between border-t border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 px-3 py-1.5 text-xs text-neutral-600 dark:text-neutral-400">
            <button
                className="flex items-center gap-1.5 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
                onClick={handleClick}
                title={status.message || 'Bấm để đồng bộ ngay'}
            >
                <StatusIcon state={status.state} syncing={syncing} />
                <span>{syncing ? 'Đang đồng bộ…' : STATE_LABEL[status.state] ?? status.state}</span>
            </button>
            <button className="flex items-center gap-1 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors" onClick={onOpenSettings}>
                <Settings className="h-3 w-3" />
                <span>Cấu hình đồng bộ</span>
            </button>
        </div>
    )
}

import {useEffect, useState} from 'react'
import {GetSyncStatus, SyncNow} from '../../wailsjs/go/main/App'
import {gitsync} from '../../wailsjs/go/models'
import {EventsOn} from '../../wailsjs/runtime/runtime'

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

const STATE_ICON: Record<string, string> = {
    not_configured: '⚙️',
    idle: '✅',
    syncing: '🔄',
    conflict: '⚠️',
    offline: '📴',
    error: '❌',
}

// SyncStatusBar hiển thị trạng thái đồng bộ GitHub (Phase 4) ở cuối màn hình,
// cho phép bấm để đồng bộ ngay hoặc mở cấu hình.
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
            // trạng thái lỗi đã được phát qua sự kiện sync:status
        } finally {
            setSyncing(false)
        }
    }

    return (
        <div className="flex items-center justify-between border-t border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-400">
            <button
                className="flex items-center gap-1.5 hover:text-neutral-200"
                onClick={handleClick}
                title={status.message || 'Bấm để đồng bộ ngay'}
            >
                <span>{STATE_ICON[status.state] ?? '⚙️'}</span>
                <span>{syncing ? 'Đang đồng bộ…' : STATE_LABEL[status.state] ?? status.state}</span>
            </button>
            <button className="hover:text-neutral-200" onClick={onOpenSettings}>
                Cấu hình đồng bộ
            </button>
        </div>
    )
}

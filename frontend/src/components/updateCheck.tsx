import {toast} from 'sonner'
import {ArrowUpCircle, X} from 'lucide-react'
import {CheckForUpdate} from '../../wailsjs/go/main/App'
import {BrowserOpenURL} from '../../wailsjs/runtime/runtime'
import {updater} from '../../wailsjs/go/models'
import {translate} from '../i18n'

const UPDATE_TOAST_ID = 'update-available'

let startupCheckStarted = false

function format(template: string, info: updater.Info): string {
    return template.replace('{latest}', info.latestVersion).replace('{current}', info.currentVersion)
}

/** Shows a persistent toast announcing a new release, with Details and close buttons. */
export function showUpdateAvailableToast(info: updater.Info) {
    toast.custom(
        (id) => (
            <div className="flex w-[356px] items-start gap-3 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 text-neutral-800 dark:text-neutral-100 shadow-lg">
                <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{translate('updateAvailableTitle')}</div>
                    <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                        {format(translate('updateAvailableDesc'), info)}
                    </div>
                    <button
                        onClick={() => {
                            BrowserOpenURL(info.releaseUrl)
                            toast.dismiss(id)
                        }}
                        className="mt-3 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
                    >
                        {translate('updateDetailsBtn')}
                    </button>
                </div>
                <button
                    onClick={() => toast.dismiss(id)}
                    aria-label="Close"
                    className="-mr-1 -mt-1 rounded p-1 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        ),
        {id: UPDATE_TOAST_ID, duration: Infinity},
    )
}

/**
 * Checks GitHub for a newer release once per app launch. Runs in the background
 * and stays silent on failure or when already up to date.
 */
export function runStartupUpdateCheck() {
    if (startupCheckStarted) return
    startupCheckStarted = true
    CheckForUpdate()
        .then((info) => {
            if (info?.available) showUpdateAvailableToast(info)
        })
        .catch(() => {})
}

/** Manual check triggered by the user; reports every outcome via toast. */
export async function checkForUpdateManually(): Promise<updater.Info | null> {
    try {
        const info = await CheckForUpdate()
        if (info.available) {
            showUpdateAvailableToast(info)
        } else {
            toast.success(format(translate('upToDateMsg'), info))
        }
        return info
    } catch (err) {
        toast.error(translate('updateCheckFailed'), {description: String(err)})
        return null
    }
}

// Checks GitHub Releases for a newer version of the app. Ported from the Go
// build's internal/updater: drafts and pre-releases are ignored, and the
// release link is only trusted when it points at this repository.

const REPO_OWNER = 'bs135'
const REPO_NAME = 'logledge'
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`
const CHECK_TIMEOUT_MS = 10_000

/** Public releases page, used as a safe fallback link. */
export const RELEASES_PAGE_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`

export interface UpdateInfo {
    currentVersion: string
    latestVersion: string
    releaseName: string
    releaseUrl: string
    publishedAt: string
    available: boolean
}

interface GitHubRelease {
    tag_name?: string
    name?: string
    html_url?: string
    published_at?: string
    draft?: boolean
    prerelease?: boolean
}

function normalizeVersion(v: string): string {
    return v.trim().replace(/^[vV]/, '')
}

function splitVersion(v: string): [number[], string] {
    let core = normalizeVersion(v)
    const plus = core.indexOf('+')
    if (plus >= 0) core = core.slice(0, plus)
    let pre = ''
    const dash = core.indexOf('-')
    if (dash >= 0) {
        pre = core.slice(dash + 1)
        core = core.slice(0, dash)
    }
    return [core.split('.').map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : 0)), pre]
}

/**
 * Compares two semantic versions (an optional "v" prefix is ignored) and
 * returns 1 if a > b, -1 if a < b and 0 if equal. A pre-release (1.0.0-beta)
 * sorts before its release; build metadata (+build.5) is ignored.
 */
export function compareVersions(a: string, b: string): number {
    const [coreA, preA] = splitVersion(a)
    const [coreB, preB] = splitVersion(b)
    for (let i = 0; i < Math.max(coreA.length, coreB.length); i++) {
        const x = coreA[i] ?? 0
        const y = coreB[i] ?? 0
        if (x !== y) return x > y ? 1 : -1
    }
    if (preA === preB) return 0
    if (preA === '') return 1
    if (preB === '') return -1
    return preA > preB ? 1 : -1
}

/** Only accepts links to this repository's releases, since they open in the browser. */
export function safeReleaseURL(raw: string | undefined): string {
    return raw?.startsWith(RELEASES_PAGE_URL + '/') ? raw : RELEASES_PAGE_URL
}

/**
 * Fetches the latest release and compares it with currentVersion. Throws on
 * network or HTTP errors so a manual check can report them.
 */
export async function checkForUpdate(currentVersion: string, fetchImpl: typeof fetch = fetch): Promise<UpdateInfo> {
    const info: UpdateInfo = {
        currentVersion: normalizeVersion(currentVersion),
        latestVersion: '',
        releaseName: '',
        releaseUrl: '',
        publishedAt: '',
        available: false,
    }

    const res = await fetchImpl(LATEST_RELEASE_API, {
        headers: {Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'},
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    if (!res.ok) {
        throw new Error(`fetch latest release: unexpected status ${res.status}`)
    }
    const rel = (await res.json()) as GitHubRelease
    if (rel.draft || rel.prerelease || !rel.tag_name?.trim()) {
        return info
    }

    info.latestVersion = normalizeVersion(rel.tag_name)
    info.releaseName = rel.name ?? ''
    info.publishedAt = rel.published_at ?? ''
    info.releaseUrl = safeReleaseURL(rel.html_url)
    info.available = compareVersions(info.latestVersion, info.currentVersion) > 0
    return info
}

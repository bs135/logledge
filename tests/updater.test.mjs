import test from 'node:test'
import assert from 'node:assert'
import esbuild from 'esbuild'

// Compile updater.ts using esbuild to test directly in Node.js
const buildResult = esbuild.buildSync({
    entryPoints: ['src/lib/updater.ts'],
    bundle: true,
    format: 'cjs',
    write: false,
})

const mod = {exports: {}}
new Function('exports', 'module', buildResult.outputFiles[0].text)(mod.exports, mod)
const {compareVersions, checkForUpdate, RELEASES_PAGE_URL} = mod.exports

function fakeFetch(status, body) {
    return async () => new Response(JSON.stringify(body), {status})
}

test('compareVersions', () => {
    const cases = [
        ['0.4.0', '0.4.0', 0],
        ['v0.4.0', '0.4.0', 0],
        ['0.4.1', '0.4.0', 1],
        ['0.5.0', '0.4.9', 1],
        ['1.0.0', '0.99.99', 1],
        ['0.3.1', '0.4.0', -1],
        ['0.10.0', '0.9.0', 1],
        ['1.0', '1.0.0', 0],
        ['1.0.0-beta', '1.0.0', -1],
        ['1.0.0', '1.0.0-rc.1', 1],
        ['1.0.0-rc.2', '1.0.0-rc.1', 1],
        ['1.0.0+build.5', '1.0.0', 0],
    ]
    for (const [a, b, want] of cases) {
        assert.strictEqual(compareVersions(a, b), want, `compareVersions(${a}, ${b})`)
    }
})

test('newer release is available', async () => {
    const url = 'https://github.com/bs135/logledge/releases/tag/v0.6.0'
    const info = await checkForUpdate('0.5.0', fakeFetch(200, {tag_name: 'v0.6.0', name: 'v0.6.0', html_url: url}))
    assert.strictEqual(info.available, true)
    assert.strictEqual(info.latestVersion, '0.6.0')
    assert.strictEqual(info.releaseUrl, url)
})

test('same version is not available', async () => {
    const info = await checkForUpdate('v0.4.0', fakeFetch(200, {tag_name: 'v0.4.0'}))
    assert.strictEqual(info.available, false)
    assert.strictEqual(info.currentVersion, '0.4.0')
})

test('pre-release is ignored', async () => {
    const info = await checkForUpdate('0.4.0', fakeFetch(200, {tag_name: 'v9.0.0', prerelease: true}))
    assert.strictEqual(info.available, false)
    assert.strictEqual(info.latestVersion, '')
})

test('foreign release URL falls back to the releases page', async () => {
    const info = await checkForUpdate('0.4.0', fakeFetch(200, {tag_name: 'v1.0.0', html_url: 'https://evil.example.com/x'}))
    assert.strictEqual(info.releaseUrl, RELEASES_PAGE_URL)
})

test('HTTP error is reported', async () => {
    await assert.rejects(checkForUpdate('0.4.0', fakeFetch(403, {message: 'rate limited'})), /unexpected status 403/)
})

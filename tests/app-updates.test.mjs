import test from 'node:test'
import assert from 'node:assert/strict'
import { createUpdateController } from '../src/lib/update-controller.ts'
import { prepareDesktopLeave } from '../src/lib/desktop-leave.ts'
import { releaseConfig, validateVersions, updateManifest } from '../scripts/update-release.mjs'

const release = { version: '0.1.3', notes: '修复与优化' }
function fixture(overrides = {}) {
  const calls = []
  const host = { info: async () => ({ currentVersion: '0.1.2', configured: true }), check: async () => { calls.push('check'); return release }, download: async progress => { calls.push('download'); progress({ downloaded: 5, total: 10 }) }, cancel: async () => calls.push('cancel'), beforeInstall: async () => { calls.push('save'); return true }, install: async () => calls.push('install'), available: () => calls.push('notify'), ...overrides }
  return { controller: createUpdateController(host), calls }
}
test('unconfigured updater never checks a feed or claims a current version is latest', async () => {
  const f = fixture({ info: async () => ({ currentVersion: '0.1.2', configured: false, reason: '未配置' }) })
  await f.controller.check(true); assert.deepEqual(f.calls, []); assert.equal(f.controller.getSnapshot().checkedAt, null)
})
test('background check notifies once, verified download waits for an explicit install and save', async () => {
  const f = fixture(); await f.controller.check(true); await f.controller.download()
  assert.deepEqual(f.calls, ['check', 'notify', 'download']); assert.equal(f.controller.getSnapshot().phase, 'ready')
  await f.controller.install(); assert.deepEqual(f.calls, ['check', 'notify', 'download', 'save', 'install'])
})
test('failed signatures and cancelled downloads never reach ready; retries work', async () => {
  let fail = true
  const f = fixture({ download: async () => { if (fail) throw Error('签名无效') } })
  await f.controller.check(); await f.controller.download(); assert.equal(f.controller.getSnapshot().phase, 'available')
  await f.controller.install(); assert.ok(!f.calls.includes('install'))
  fail = false; await f.controller.download(); assert.equal(f.controller.getSnapshot().phase, 'ready')
})
test('cancel waits for native download to settle and suppresses late progress and readiness', async () => {
  let finish, progress
  const f = fixture({ download: callback => { progress = callback; return new Promise(resolve => { finish = resolve }) } })
  await f.controller.check(); const task = f.controller.download(); await f.controller.cancel()
  progress({ downloaded: 10, total: 10 }); finish(); await task
  assert.equal(f.controller.getSnapshot().phase, 'available'); assert.equal(f.controller.getSnapshot().progress.downloaded, 0)
})
test('checks and installs are serialized; a cancelled save keeps the verified package ready', async () => {
  let resolveCheck
  const f = fixture({ check: () => new Promise(resolve => { resolveCheck = resolve }), beforeInstall: async () => false })
  await f.controller.initialize(); const first = f.controller.check(); await Promise.resolve(); await f.controller.check()
  resolveCheck(release); await first; await f.controller.download(); await f.controller.install()
  assert.equal(f.controller.getSnapshot().phase, 'ready'); assert.ok(!f.calls.includes('install'))
})
test('network errors are retryable and not represented as up to date', async () => {
  let fail = true
  const f = fixture({ check: async () => { if (fail) throw Error('offline'); return null } })
  await f.controller.check(); assert.equal(f.controller.getSnapshot().checkedAt, null); assert.equal(f.controller.getSnapshot().error, 'offline')
  fail = false; await f.controller.check(); assert.ok(f.controller.getSnapshot().checkedAt); assert.equal(f.controller.getSnapshot().error, null)
})
test('installation stops on active file operations, failed recovery save and declined dirty-file confirmation', async () => {
  const calls = []
  const host = { update: true, busy: false, ready: true, persist: async () => { calls.push('save'); return false }, file: async () => ({ dirty: true, uncertain: false }), warn: () => calls.push('warn'), confirm: async () => { calls.push('confirm'); return false } }
  assert.equal(await prepareDesktopLeave({ ...host, busy: true }), false); assert.deepEqual(calls, ['warn'])
  calls.length = 0; assert.equal(await prepareDesktopLeave(host), false); assert.deepEqual(calls, ['save', 'warn'])
  calls.length = 0; assert.equal(await prepareDesktopLeave({ ...host, persist: async () => true }), false); assert.deepEqual(calls, ['confirm'])
})
test('release preparation rejects version drift, prereleases, empty keys and unbound signatures', () => {
  const publicKey = Buffer.from('untrusted comment: minisign public key\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe').toString('base64')
  assert.equal(releaseConfig(publicKey).plugins.updater.requireSignedVersion, true)
  assert.equal(validateVersions({ version: '0.1.3' }, { version: '0.1.3' }, '[package]\nversion = "0.1.3"', 'v0.1.3'), '0.1.3')
  for (const [version, cargo, tag] of [['0.1.3', 'version = "0.1.2"', 'v0.1.3'], ['0.1.3-alpha.1', 'version = "0.1.3-alpha.1"', 'v0.1.3-alpha.1'], ['0.1.3', 'version = "0.1.3"', 'v0.1.4']]) assert.throws(() => validateVersions({ version }, { version }, cargo, tag))
  assert.throws(() => releaseConfig('')); assert.throws(() => updateManifest('0.1.3', Buffer.from('unsigned').toString('base64')))
})
test('release manifest uses version-bound signature text and immutable versioned installer URLs', () => {
  // Framing fixture only: cryptographic verification is performed by Tauri, never this script.
  const sig = Buffer.from(`untrusted comment: fixture\n${Buffer.alloc(74).toString('base64')}\ntrusted comment: timestamp:1\tversion:0.1.3\n${Buffer.alloc(64).toString('base64')}`).toString('base64')
  const manifest = updateManifest('0.1.3', sig, '更新说明', '2026-11-18T00:00:00Z')
  assert.match(manifest.platforms['windows-x86_64'].url, /\/v0\.1\.3\/OnlyPing_0\.1\.3_x64-setup\.exe$/)
  assert.equal(manifest.platforms['windows-x86_64'].signature, sig); assert.throws(() => updateManifest('0.1.4', sig))
})

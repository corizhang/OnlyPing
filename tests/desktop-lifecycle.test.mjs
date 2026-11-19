import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopLifecycle } from '../src/lib/desktop-lifecycle.ts'

function fixture(overrides = {}) {
  const calls = []
  const info = { preferences: { closeBehavior: 'ask', minimizeToTray: false, rememberWindow: true, autoCheckUpdates: true }, trayAvailable: true }
  const host = {
    read: async () => info,
    save: async p => { calls.push(['save', p]); info.preferences = p },
    choose: async () => ({ behavior: 'tray', remember: true }),
    beforeExit: async () => { calls.push('exit-guard'); return true },
    beforeHide: async () => { calls.push('hide-guard'); return true },
    action: async action => { calls.push(action) },
    error: () => calls.push('error'), ...overrides,
  }
  return { calls, info, request: createDesktopLifecycle(host) }
}
test('first close remembers the choice and persists recovery before hiding', async () => {
  const f = fixture(); await f.request('close')
  assert.deepEqual(f.calls, [['save', { closeBehavior: 'tray', minimizeToTray: false, rememberWindow: true, autoCheckUpdates: true }], 'hide-guard', 'hide'])
})
test('explicit tray exit ignores hide preference and always uses the exit guard', async () => {
  const f = fixture(); f.info.preferences.closeBehavior = 'tray'; await f.request('exit')
  assert.deepEqual(f.calls, ['exit-guard', 'exit'])
})
test('unavailable tray falls back to guarded exit; minimize keeps the normal OS behavior', async () => {
  const f = fixture(); f.info.trayAvailable = false; f.info.preferences.closeBehavior = 'tray'
  await f.request('minimize'); assert.deepEqual(f.calls, [])
  await f.request('close'); assert.deepEqual(f.calls, ['exit-guard', 'exit'])
})
test('failed or cancelled saves never hide or exit; minimize restores the window', async () => {
  const f = fixture({ beforeExit: async () => false, beforeHide: async () => false })
  f.info.preferences.closeBehavior = 'tray'; f.info.preferences.minimizeToTray = true
  await f.request('minimize'); assert.deepEqual(f.calls, ['restore'])
  await f.request('exit'); assert.deepEqual(f.calls, ['restore'])
})
test('cancelled close choice does not change settings or run a guard', async () => {
  const f = fixture({ choose: async () => null }); await f.request('close'); assert.deepEqual(f.calls, [])
})
test('storage failure restores the window and leaves recovery guards untouched', async () => {
  const f = fixture({ save: async () => { throw Error('disk full') } }); await f.request('close')
  assert.deepEqual(f.calls, ['restore', 'error'])
})
test('simultaneous requests run only one guard; a cancelled attempt can be retried', async () => {
  let finish
  let count = 0
  const f = fixture({ beforeExit: () => { count++; return new Promise(resolve => { finish = resolve }) } })
  const first = f.request('exit'); await Promise.resolve()
  await f.request('exit'); assert.equal(count, 1)
  finish(false); await first
  const second = f.request('exit'); await Promise.resolve(); assert.equal(count, 2)
  finish(true); await second; assert.deepEqual(f.calls, ['exit'])
})

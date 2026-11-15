import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopAIConfig } from '../src/lib/desktop-ai-config.ts'

const config = { baseUrl: 'https://example.invalid', model: 'test', demo: false, apiKey: 'synthetic-key', keyStorage: 'local' }
function fixture(overrides = {}) {
  const state = { settings: { ...config }, secret: null, session: 'old-session', writes: [] }
  const host = {
    readSettings: () => state.settings,
    writeSettings: value => { state.settings = value },
    clearSession: () => { state.session = null },
    readKey: async () => state.secret,
    writeKey: async value => { state.writes.push(value); state.secret = value || null },
    ...overrides,
  }
  return { state, store: createDesktopAIConfig(host) }
}

test('migrates legacy persistent key before removing plaintext and restores after restart', async () => {
  const { state, store } = fixture()
  assert.equal((await store.load()).apiKey, config.apiKey)
  assert.equal(state.secret, config.apiKey)
  assert.equal(state.settings.apiKey, '')
  assert.equal(state.session, null)
  const restored = createDesktopAIConfig({ readSettings: () => ({ ...state.settings, demo: true }), readKey: async () => state.secret, writeKey: async () => {}, writeSettings: () => {}, clearSession: () => {} })
  assert.equal((await restored.load()).demo, false)
})

test('migration failure preserves old plaintext for retry and does not cache failure', async () => {
  let fail = true
  const { state, store } = fixture({ writeKey: async () => { if (fail) throw Error('unavailable') } })
  await assert.rejects(store.load(), /unavailable/)
  assert.equal(state.settings.apiKey, config.apiKey)
  fail = false
  assert.equal((await store.load()).apiKey, config.apiKey)
  assert.equal(state.settings.apiKey, '')
})

test('vault read failure is not mistaken for missing key or overwritten by migration', async () => {
  const { state, store } = fixture({ readKey: async () => { throw Error('denied') } })
  await assert.rejects(store.load(), /denied/)
  assert.deepEqual(state.writes, [])
  assert.equal(state.settings.apiKey, config.apiKey)
})

test('session mode clears vault and browser storage but retains only in-memory key', async () => {
  const { state, store } = fixture()
  await store.save({ ...config, keyStorage: 'session' })
  assert.equal(state.secret, null)
  assert.equal(state.settings.apiKey, '')
  assert.equal(state.session, null)
  assert.equal((await store.load()).apiKey, config.apiKey)
})

test('failed save does not activate new configuration and can be retried', async () => {
  let fail = false
  const { state, store } = fixture({ writeKey: async () => { if (fail) throw Error('failed') } })
  await store.load()
  fail = true
  await assert.rejects(store.save({ ...config, apiKey: 'replacement' }), /failed/)
  assert.equal((await store.load()).apiKey, config.apiKey)
  assert.equal(state.settings.apiKey, '')
  fail = false
  await store.save({ ...config, apiKey: '' })
  assert.equal((await store.load()).apiKey, '')
})

test('hydration and concurrent settings edits serialize in invocation order', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const { state, store } = fixture({ readKey: async () => { await gate; return null } })
  const loading = store.load()
  const saving = store.save({ ...config, apiKey: 'latest' })
  release()
  await Promise.all([loading, saving])
  assert.equal((await store.load()).apiKey, 'latest')
  assert.equal(state.secret, 'latest')
  assert.ok(!JSON.stringify(state.settings).includes('latest'))
})

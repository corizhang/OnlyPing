import test from 'node:test'
import assert from 'node:assert/strict'
import { aiPrivacyScanPage, aiGenerateDescription, aiAnnotateFromDescription, aiSuggestMosaics, aiSuggestNumbers, loadAIConfig, saveAIConfig } from '../src/lib/ai.ts'
import { cancellableDelay, isTaskCancelled } from '../src/lib/render-task.ts'

const config = { baseUrl: 'https://example.invalid/v1', apiKey: 'test-only', model: 'test', demo: false }
const page = { id: 'p', name: 'test', image: 'data:image/png;base64,eA==', width: 10, height: 10, annotations: [], notes: '' }

test('session keys never enter persistent settings and can switch storage modes', () => {
  const oldLocal = globalThis.localStorage, oldSession = globalThis.sessionStorage
  const storage = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) } }
  globalThis.localStorage = storage(); globalThis.sessionStorage = storage()
  try {
    saveAIConfig({ ...config, keyStorage: 'local' })
    assert.equal(loadAIConfig().apiKey, 'test-only')
    saveAIConfig({ ...config, keyStorage: 'session' })
    assert.ok(!localStorage.getItem('mbz-ai-config').includes('test-only'))
    assert.equal(loadAIConfig().apiKey, 'test-only')
    assert.equal(loadAIConfig().demo, false)
    sessionStorage.removeItem('mbz-ai-session-key')
    assert.equal(loadAIConfig().apiKey, '')
    assert.equal(loadAIConfig().demo, true)
    saveAIConfig({ ...config, keyStorage: 'session' })
    saveAIConfig({ ...config, keyStorage: 'local' })
    assert.equal(sessionStorage.getItem('mbz-ai-session-key'), null)
    assert.equal(loadAIConfig().keyStorage, 'local')
  } finally { globalThis.localStorage = oldLocal; globalThis.sessionStorage = oldSession }
})

test('cancelling privacy scan aborts the underlying fetch and does not retry', async () => {
  const original = globalThis.fetch
  let calls = 0
  let requestSignal
  globalThis.fetch = async (_url, options) => {
    calls++; requestSignal = options.signal
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
  }
  try {
    const controller = new AbortController()
    const request = aiPrivacyScanPage(config, page, [], controller.signal)
    const rejected = assert.rejects(request, isTaskCancelled)
    controller.abort()
    await rejected
    assert.equal(requestSignal.aborted, true)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = original }
})

test('an already cancelled scan never sends its image', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('unexpected fetch') }
  try {
    const controller = new AbortController(); controller.abort()
    await assert.rejects(aiPrivacyScanPage(config, page, [], controller.signal), isTaskCancelled)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = original }
})

test('cancellation interrupts retry delay without waiting for the timeout', async () => {
  const controller = new AbortController()
  const waiting = cancellableDelay(90_000, controller.signal)
  const rejected = assert.rejects(waiting, isTaskCancelled)
  controller.abort()
  await rejected
})

test('all generation operations forward cancellation to fetch without retrying', async () => {
  const original = globalThis.fetch
  try {
    const operations = [
      signal => aiGenerateDescription(config, page, 0, 1, '', 0, signal),
      signal => aiAnnotateFromDescription(config, page, '点击', signal),
      signal => aiSuggestMosaics(config, page, signal),
      signal => aiSuggestNumbers(config, page, signal),
    ]
    for (const operation of operations) {
      let calls = 0
      globalThis.fetch = async (_url, options) => {
        calls++
        return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }))
      }
      const controller = new AbortController()
      const rejected = assert.rejects(operation(controller.signal), isTaskCancelled)
      controller.abort()
      await rejected
      assert.equal(calls, 1)
    }
  } finally { globalThis.fetch = original }
})

test('saved empty-key configurations remain in demo mode after reload', () => {
  const original = globalThis.localStorage
  try {
    globalThis.localStorage = { getItem: () => JSON.stringify({ ...config, apiKey: '', demo: false }) }
    assert.equal(loadAIConfig().demo, true)
    globalThis.localStorage = { getItem: () => '{broken' }
    assert.equal(loadAIConfig().demo, true)
  } finally { globalThis.localStorage = original }
})

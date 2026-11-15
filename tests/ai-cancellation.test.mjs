import test from 'node:test'
import assert from 'node:assert/strict'
import { aiPrivacyScanPage } from '../src/lib/ai.ts'
import { cancellableDelay, isTaskCancelled } from '../src/lib/render-task.ts'

const config = { baseUrl: 'https://example.invalid/v1', apiKey: 'test-only', model: 'test', demo: false }
const page = { id: 'p', name: 'test', image: 'data:image/png;base64,eA==', width: 10, height: 10, annotations: [], notes: '' }

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

import test from 'node:test'
import assert from 'node:assert/strict'
import { runAIBatch } from '../src/lib/ai-batch.ts'
import { isTaskCancelled } from '../src/lib/render-task.ts'

test('batch failure does not stop later pages', async () => {
  const completed = []
  const failed = await runAIBatch({ targets: ['a', 'b', 'c'], signal: new AbortController().signal,
    onProgress: () => {}, onInterrupted: () => assert.fail('unexpected cancellation'),
    process: async page => { if (page === 'b') throw new Error('bad output'); completed.push(page) },
  })
  assert.deepEqual(completed, ['a', 'c'])
  assert.deepEqual(failed, ['b'])
})

test('cancelled batch retries failed and remaining pages but never repeats completed ones', async () => {
  const controller = new AbortController()
  let remaining
  const applied = []
  await assert.rejects(runAIBatch({ targets: ['a', 'b', 'c', 'd'], signal: controller.signal,
    onProgress: () => {}, onInterrupted: pages => { remaining = pages },
    process: async page => {
      if (page === 'b') throw new Error('first attempt failed')
      if (page === 'c') { controller.abort(); controller.signal.throwIfAborted() }
      applied.push(page)
    },
  }), isTaskCancelled)
  assert.deepEqual(applied, ['a'])
  assert.deepEqual(remaining, ['b', 'c', 'd'])
  await runAIBatch({ targets: remaining, signal: new AbortController().signal, onProgress: () => {}, onInterrupted: () => {}, process: async page => { applied.push(page) } })
  assert.deepEqual(applied, ['a', 'b', 'c', 'd'])
})

test('a pre-cancelled batch never starts a page', async () => {
  const controller = new AbortController(); controller.abort()
  let remaining
  await assert.rejects(runAIBatch({ targets: [1, 2], signal: controller.signal, onProgress: () => assert.fail('started'), onInterrupted: pages => { remaining = pages }, process: async () => assert.fail('sent request') }), isTaskCancelled)
  assert.deepEqual(remaining, [1, 2])
})

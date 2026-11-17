import test from 'node:test'
import assert from 'node:assert/strict'
import { RenderQueue, canvasBlob, taskCheckpoint, isTaskCancelled, releaseCanvas } from '../src/lib/render-task.ts'

test('queued renders execute serially and a cancelled queued job never starts', async () => {
  const queue = new RenderQueue()
  const events = []
  let release
  const first = queue.run({}, async () => { events.push('first'); await new Promise(resolve => { release = resolve }); events.push('done') })
  await new Promise(resolve => setTimeout(resolve, 0))
  const controller = new AbortController()
  const skipped = queue.run({ signal: controller.signal }, async () => events.push('skipped'))
  const checked = assert.rejects(skipped, isTaskCancelled)
  controller.abort()
  const last = queue.run({}, async () => events.push('last'))
  release()
  await Promise.all([first, checked, last])
  assert.deepEqual(events, ['first', 'done', 'last'])
})

test('a failed render does not poison the next task', async () => {
  const queue = new RenderQueue()
  await assert.rejects(queue.run({}, async () => { throw new Error('render failure') }), /render failure/)
  assert.equal(await queue.run({}, async () => 42), 42)
})

test('cancellation during image encoding rejects the late result', async () => {
  const controller = new AbortController()
  let finish
  const result = canvasBlob({ toBlob: callback => { finish = callback } }, { signal: controller.signal })
  const rejected = assert.rejects(result, isTaskCancelled)
  controller.abort()
  finish(new Blob(['image']))
  await rejected
})

test('pre-cancelled tasks do not report progress or encode images', async () => {
  const controller = new AbortController(); controller.abort()
  let touched = false
  await assert.rejects(taskCheckpoint({ signal: controller.signal, onProgress: () => { touched = true } }, 'render', 0, 1), isTaskCancelled)
  await assert.rejects(canvasBlob({ toBlob: () => { touched = true } }, { signal: controller.signal }), isTaskCancelled)
  assert.equal(touched, false)
})

test('canvas release clears its backing buffer', () => {
  const canvas = { width: 4000, height: 3000 }
  releaseCanvas(canvas)
  assert.deepEqual(canvas, { width: 0, height: 0 })
})
test('requested encoding quality is forwarded and silent PNG fallback is rejected', async () => {
  const blob = new Blob(['jpeg'], { type: 'image/jpeg' })
  assert.equal(await canvasBlob({ toBlob: (callback, type, quality) => { assert.equal(type, 'image/jpeg'); assert.equal(quality, .85); callback(blob) } }, {}, 'image/jpeg', .85), blob)
  await assert.rejects(canvasBlob({ toBlob: callback => callback(new Blob(['png'], { type: 'image/png' })) }, {}, 'image/jpeg', .9), /不支持所选图片编码/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeImageExportPreview } from '../src/lib/image-export-preview.ts'
test('preview encodes PNG reference and JPEG from the same composed pixels', async () => {
  const calls = []
  const canvas = { width: 160, height: 90, toBlob: (callback, type, quality) => { calls.push([type, quality]); callback(new Blob([type], { type })) } }
  const result = await encodeImageExportPreview(canvas, 85)
  assert.deepEqual(calls, [['image/png', undefined], ['image/jpeg', .85]])
  assert.deepEqual([result.width, result.height], [160, 90])
  assert.equal(result.reference.type, 'image/png'); assert.equal(result.output.type, 'image/jpeg')
})
test('invalid quality and pre-cancelled preview never start encoding', async () => {
  const canvas = { width: 1, height: 1, toBlob: () => assert.fail('must not encode') }
  for (const quality of [0, 101, NaN, 1.5]) await assert.rejects(encodeImageExportPreview(canvas, quality), /质量/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(encodeImageExportPreview(canvas, 90, { signal: controller.signal }), { name: 'AbortError' })
})
test('preview cancellation after PNG encoding never starts JPEG and returns no half-result', async () => {
  const controller = new AbortController(); let calls = 0
  const canvas = { width: 1, height: 1, toBlob: (callback, type) => { calls++; controller.abort(); callback(new Blob(['png'], { type })) } }
  await assert.rejects(encodeImageExportPreview(canvas, 90, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls, 1)
})
test('JPEG failure and unsupported encoding do not return misleading previews', async () => {
  for (const fallback of [true, false]) {
    const canvas = { width: 1, height: 1, toBlob: (callback, type) => callback(type === 'image/png' ? new Blob(['reference'], { type }) : fallback ? new Blob(['fallback'], { type: 'image/png' }) : null) }
    await assert.rejects(encodeImageExportPreview(canvas, 90), fallback ? /不支持/ : /编码失败/)
  }
})

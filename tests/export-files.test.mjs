import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { packageLongImages } from '../src/lib/export-files.ts'
import { isTaskCancelled } from '../src/lib/render-task.ts'

test('one long image stays a PNG without repackaging', async () => {
  const image = new Blob(['png'])
  const file = await packageLongImages('说明', [image])
  assert.equal(file.blob, image)
  assert.equal(file.filename, '说明-长图.png')
})

test('multiple long images download as one readable ordered ZIP with safe paths', async () => {
  const file = await packageLongImages('../a/b', [new Blob(['first']), new Blob(['second'])])
  assert.equal(file.blob.type, 'application/zip')
  const zip = await JSZip.loadAsync(await file.blob.arrayBuffer())
  assert.deepEqual(Object.keys(zip.files), ['长图-001.png', '长图-002.png'])
  assert.equal(await zip.file('长图-001.png').async('string'), 'first')
  assert.equal(await zip.file('长图-002.png').async('string'), 'second')
})

test('cancelled packaging rejects before returning any download', async () => {
  const controller = new AbortController()
  const images = [new Blob(['one']), new Blob(['two'])]
  const first = images[0].arrayBuffer.bind(images[0])
  images[0].arrayBuffer = async () => { controller.abort(); return first() }
  await assert.rejects(packageLongImages('x', images, { signal: controller.signal }), isTaskCancelled)
  await assert.rejects(packageLongImages('x', [new Blob(['one'])], { signal: controller.signal }), isTaskCancelled)
})

test('empty long image output fails explicitly', async () => {
  await assert.rejects(packageLongImages('x', []), /没有可导出/)
})

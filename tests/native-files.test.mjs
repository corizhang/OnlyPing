import test from 'node:test'
import assert from 'node:assert/strict'
import { createNativeFiles, safeFilename } from '../src/lib/native-files.ts'

const host = overrides => ({ save: async () => 'D:/chosen/output.png', open: async () => null, readFile: async () => new Uint8Array(), writeFile: async () => {}, ...overrides })

test('native save uses the chosen path and preserves exact binary bytes', async () => {
  let options, written
  const files = createNativeFiles(host({ save: async next => { options = next; return 'D:/用户选择/输出.png' }, writeFile: async (path, bytes) => { written = { path, bytes } } }))
  await files.save(new Blob([new Uint8Array([0, 127, 255])]), '步骤/一.png')
  assert.equal(options.defaultPath, '步骤_一.png')
  assert.deepEqual(options.filters[0].extensions, ['png'])
  assert.equal(written.path, 'D:/用户选择/输出.png')
  assert.deepEqual([...written.bytes], [0, 127, 255])
})

test('cancelled or aborted native save never writes a file', async () => {
  let writes = 0
  const files = createNativeFiles(host({ save: async () => null, writeFile: async () => writes++ }))
  await assert.rejects(files.save(new Blob(['x']), 'x.json'), { name: 'AbortError' })
  const controller = new AbortController()
  const aborting = createNativeFiles(host({ save: async () => { controller.abort(); return 'chosen.json' }, writeFile: async () => writes++ }))
  await assert.rejects(aborting.save(new Blob(['x']), 'x.json', controller.signal), { name: 'AbortError' })
  assert.equal(writes, 0)
})

test('native write failure propagates rather than pretending a browser download succeeded', async () => {
  const files = createNativeFiles(host({ writeFile: async () => { throw new Error('Disk full') } }))
  await assert.rejects(files.save(new Blob(['project']), 'project.json'), /Disk full/)
})

test('native project open reads only the picked file and retains Unicode content', async () => {
  let read
  const files = createNativeFiles(host({ open: async () => 'D:\\项目\\中文.json', readFile: async path => { read = path; return new TextEncoder().encode('{"title":"中文项目"}') } }))
  const file = await files.openProject()
  assert.equal(read, 'D:\\项目\\中文.json')
  assert.equal(file.name, '中文.json')
  assert.equal(file.type, 'application/json')
  assert.equal(JSON.parse(await file.text()).title, '中文项目')
})

test('cancelled project open does not access disk and unexpected multiple selection is rejected', async () => {
  const files = createNativeFiles(host({ readFile: async () => assert.fail('unexpected read') }))
  assert.equal(await files.openProject(), null)
  await assert.rejects(createNativeFiles(host({ open: async () => ['a', 'b'] })).openProject(), /单个项目/)
})

test('native suggested names cannot introduce directories, control characters or reserved Windows names', () => {
  assert.equal(safeFilename('../步骤\u0000.json'), '.._步骤_.json')
  assert.equal(safeFilename('CON.pdf'), '_CON.pdf')
  assert.equal(safeFilename('LPT1'), '_LPT1')
  assert.equal(safeFilename('项目. '), '项目')
  assert.equal(safeFilename(''), 'OnlyPing')
})

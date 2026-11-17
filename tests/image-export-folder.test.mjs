import test from 'node:test'
import assert from 'node:assert/strict'
import { writeImagesToFolder } from '../src/lib/image-export-folder.ts'
import { planImageExport, IMAGE_EXPORT_MAX_BYTES } from '../src/lib/image-export.ts'
const jobs = () => planImageExport([0, 1, 2].map(i => ({ id: String(i), name: `中文${i}`, image: '', width: 100, height: 80, notes: '', annotations: [] })), { scope: 'all' })
function fixture() {
  const saved = [], ended = [], names = []
  const host = {
    begin: async input => { names.push(...input); return { id: 'session', path: 'D:/中文/OnlyPing-images-test' } },
    write: async (id, index, bytes) => { assert.equal(id, 'session'); saved.push({ index, bytes: [...bytes] }) },
    end: async id => { ended.push(id) },
  }
  return { host, saved, ended, names }
}
test('folder output is serial, receives planned sizes and finishes one session', async () => {
  const f = fixture(); let active = 0
  const result = await writeImagesToFolder(jobs(), async (page, start, task, dimensions) => {
    assert.equal(active++, 0); assert.deepEqual(dimensions, { width: 100, height: 80 })
    await new Promise(resolve => setTimeout(resolve, 1)); active--
    return new Blob([page.id])
  }, f.host)
  assert.equal(result.saved, 3)
  assert.deepEqual(f.saved.map(v => v.index), [0, 1, 2])
  assert.deepEqual(f.names, ['001-中文0.png', '002-中文1.png', '003-中文2.png'])
  assert.deepEqual(f.ended, ['session'])
})
test('picker cancellation and pre-cancelled task never render or write', async () => {
  const f = fixture(); let began = false
  const render = () => { throw Error('must not render') }
  await assert.rejects(writeImagesToFolder(jobs(), render, { ...f.host, begin: async () => null }), { name: 'AbortError' })
  const controller = new AbortController(); controller.abort()
  await assert.rejects(writeImagesToFolder(jobs(), render, { ...f.host, begin: async () => { began = true } }, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(began, false); assert.equal(f.saved.length, 0)
})
test('mid-write cancellation counts committed files and always closes the session', async () => {
  const f = fixture(), controller = new AbortController(), write = f.host.write
  f.host.write = async (...args) => { await write(...args); controller.abort() }
  await assert.rejects(writeImagesToFolder(jobs(), async () => new Blob(['png']), f.host, { signal: controller.signal }), error => {
    assert.equal(error.report.completed, 1); assert.equal(error.report.total, 3)
    assert.equal(error.report.locationId, 'session'); assert.equal(error.report.failedImage, undefined)
    assert.deepEqual(error.report.pending.map(page => page.index), [1, 2])
    return error.name === 'AbortError' && /已保存 1\/3.*中文/.test(error.message)
  })
  assert.equal(f.saved.length, 1); assert.equal(f.ended.length, 1)
})
test('render and disk failures identify partial output and never continue', async () => {
  for (const failWrite of [true, false]) {
    const f = fixture()
    if (failWrite) f.host.write = async () => { throw Error('disk full') }
    await assert.rejects(writeImagesToFolder(jobs(), async page => {
      if (!failWrite && page.id === '1') throw Error('decode failed')
      return new Blob(['png'])
    }, f.host), error => {
      assert.equal(error.report.status, 'failed'); assert.equal(error.report.failedImage.index, failWrite ? 0 : 1)
      assert.equal(error.report.pending.length, failWrite ? 3 : 2)
      return /导出失败/.test(error.message) && error.message.includes(`已保存 ${failWrite ? 0 : 1}/3`) && error.message.includes('D:/中文')
    })
    assert.equal(f.ended.length, 1)
  }
})
test('budget failure and finalization failure cannot report success', async () => {
  const f = fixture()
  await assert.rejects(writeImagesToFolder(jobs(), async () => ({ size: IMAGE_EXPORT_MAX_BYTES + 1 }), f.host), /200 MiB/)
  assert.equal(f.saved.length, 0); assert.equal(f.ended.length, 1)
  f.host.end = async () => { throw Error('session unavailable') }
  await assert.rejects(writeImagesToFolder(jobs().slice(0, 1), async () => new Blob(['png']), f.host), /收尾失败.*已保存 1\/1/)
})
test('cancellation while closing still reports the completed output directory', async () => {
  const f = fixture(), controller = new AbortController()
  f.host.end = async () => { controller.abort() }
  await assert.rejects(writeImagesToFolder(jobs(), async () => new Blob(['png']), f.host, { signal: controller.signal }), error => error.name === 'AbortError' && /已保存 3\/3.*中文/.test(error.message))
})
test('folder export carries JPEG filenames and encoding settings', async () => {
  const f = fixture()
  const jpeg = planImageExport(jobs().map(job => job.page), { scope: 'all' }, { size: { mode: 'original' }, numbering: 'project', format: 'jpeg', quality: 75 })
  await writeImagesToFolder(jpeg, async (page, start, task, dimensions, encoding) => { assert.deepEqual(encoding, { format: 'jpeg', quality: 75 }); return new Blob(['jpeg'], { type: 'image/jpeg' }) }, f.host)
  assert.ok(f.names.every(name => name.endsWith('.jpg')))
  assert.equal(f.saved.length, 3)
})

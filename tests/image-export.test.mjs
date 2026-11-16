import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { buildAnnotatedImages, imageExportWarnings, planImageExport, IMAGE_EXPORT_MAX_PAGES } from '../src/lib/image-export.ts'
import { isTaskCancelled } from '../src/lib/render-task.ts'

const page = (id, name = '同名/截图.png') => ({ id, name, notes: 'DO NOT EXPORT NOTES', notesRich: '<p>NO HTML</p>', image: 'data:image/png;base64,eA==', width: 100, height: 80, annotations: [], orig: { image: 'original', width: 200, height: 160, annotations: [] } })
const numbered = (id, hidden = false) => ({ id, kind: 'number', x: 20, y: 20, hidden })

test('selection preserves project order, original numbering and safe unique filenames', () => {
  const pages = [page('a'), page('b'), page('c')]
  pages[0].annotations = [numbered('1'), numbered('hidden', true), numbered('2')]
  pages[1].annotations = [numbered('3')]
  const jobs = planImageExport(pages, { scope: 'selected', ids: ['c', 'b', 'c'] })
  assert.deepEqual(jobs.map(job => job.page.id), ['b', 'c'])
  assert.deepEqual(jobs.map(job => job.numberStart), [2, 3])
  assert.deepEqual(jobs.map(job => job.filename), ['002-同名_截图.png', '003-同名_截图.png'])
  assert.equal(jobs[0].page.width, 100)
  assert.equal(jobs[0].page.orig, undefined)
  assert.equal(jobs[0].page.notes, '')
  assert.equal(jobs[0].page.notesRich, undefined)
})

test('planned annotations are isolated from subsequent gesture mutations', () => {
  const p = page('a')
  p.annotations = [{ id: 'pen', kind: 'freehand', color: '#fff', points: [{ x: 1, y: 2 }] }]
  const jobs = planImageExport([p], { scope: 'all' })
  p.annotations[0].points[0].x = 99
  assert.equal(jobs[0].page.annotations[0].points[0].x, 1)
})

test('invalid, deleted or excessive selections fail before rendering', () => {
  assert.throws(() => planImageExport([], { scope: 'all' }), /至少选择/)
  assert.throws(() => planImageExport([page('a')], { scope: 'current', currentId: null }), /至少选择/)
  assert.throws(() => planImageExport([page('a')], { scope: 'selected', ids: ['missing'] }), /删除或切换/)
  assert.throws(() => planImageExport([page('a'), page('a')], { scope: 'all' }), /重复/)
  assert.throws(() => planImageExport([{ ...page('a'), width: Infinity }], { scope: 'all' }), /尺寸无效/)
  assert.throws(() => planImageExport(Array.from({ length: IMAGE_EXPORT_MAX_PAGES + 1 }, (_, i) => page(String(i))), { scope: 'all' }), /每批最多/)
})

test('one selection keeps PNG bytes without a ZIP wrapper', async () => {
  const blob = new Blob(['png-bytes'], { type: 'image/png' })
  const output = await buildAnnotatedImages('title', planImageExport([page('a')], { scope: 'all' }), async () => blob)
  assert.equal(output.blob, blob)
  assert.equal(output.filename, '001-同名_截图.png')
})

test('ZIP contains every image with ordered safe paths and valid CRCs', async () => {
  const jobs = planImageExport([page('a', '../bad\\name'), page('b', '../bad\\name')], { scope: 'all' })
  const output = await buildAnnotatedImages('../title', jobs, async p => new Blob([`png-${p.id}`]))
  assert.ok(!output.filename.includes('/'))
  const zip = await JSZip.loadAsync(await output.blob.arrayBuffer(), { checkCRC32: true })
  assert.deepEqual(Object.keys(zip.files), jobs.map(job => job.filename))
  assert.ok(Object.keys(zip.files).every(name => !/[\\/]/.test(name)))
  assert.equal(await zip.file(jobs[0].filename).async('string'), 'png-a')
  assert.equal(await zip.file(jobs[1].filename).async('string'), 'png-b')
})

test('rendering is serial and a middle failure never returns a partial package', async () => {
  const jobs = planImageExport([page('a'), page('b'), page('c')], { scope: 'all' })
  const called = []; let active = 0, peak = 0
  await assert.rejects(buildAnnotatedImages('t', jobs, async p => {
    called.push(p.id); active++; peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 1)); active--
    if (p.id === 'b') throw Error('decode failed')
    return new Blob(['png'])
  }), /第 2 张.*decode failed/)
  assert.equal(peak, 1)
  assert.deepEqual(called, ['a', 'b'])
})

test('pre-cancelled, mid-render and packaging cancellation reject without output', async () => {
  const jobs = planImageExport([page('a'), page('b')], { scope: 'all' })
  const first = new AbortController(); first.abort()
  await assert.rejects(buildAnnotatedImages('t', jobs, async () => assert.fail('unexpected render'), { signal: first.signal }), isTaskCancelled)
  const second = new AbortController()
  await assert.rejects(buildAnnotatedImages('t', jobs, async () => { second.abort(); return new Blob(['png']) }, { signal: second.signal }), isTaskCancelled)
  const third = new AbortController()
  await assert.rejects(buildAnnotatedImages('t', jobs, async () => new Blob(['png']), { signal: third.signal, onProgress: progress => { if (progress.phase === '正在打包标注图片' && progress.completed > 0) third.abort() } }), isTaskCancelled)
})

test('capacity and empty encoding failures are explicit', async () => {
  const jobs = planImageExport([page('a'), page('b')], { scope: 'all' })
  await assert.rejects(buildAnnotatedImages('t', jobs, async () => new Blob(['1234']), {}, 7), /合计超过/)
  await assert.rejects(buildAnnotatedImages('t', jobs, async () => new Blob([])), /编码结果为空/)
})

test('pure image checks warn only for selected hidden privacy masks, not missing notes', () => {
  const pages = [page('a'), page('b')]
  pages[0].annotations = [{ id: 'm', kind: 'mosaic', x: 1, y: 1, w: 2, h: 2, hidden: true }]
  pages[1].notes = ''
  assert.equal(imageExportWarnings(planImageExport(pages, { scope: 'current', currentId: 'b' })).length, 0)
  assert.equal(imageExportWarnings(planImageExport(pages, { scope: 'all' })).length, 1)
})

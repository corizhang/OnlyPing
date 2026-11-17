import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { buildAnnotatedImages, imageExportDimensions, imageExportWarnings, planImageExport, IMAGE_EXPORT_MAX_PAGES } from '../src/lib/image-export.ts'
import { isTaskCancelled } from '../src/lib/render-task.ts'

const page = (id, name = '同名/截图.png') => ({ id, name, notes: 'DO NOT EXPORT NOTES', notesRich: '<p>NO HTML</p>', image: 'data:image/png;base64,eA==', width: 100, height: 80, annotations: [], orig: { image: 'original', width: 200, height: 160, annotations: [] } })
const numbered = (id, hidden = false) => ({ id, kind: 'number', x: 20, y: 20, hidden })
test('JPEG plans use jpg filenames and carry quality through ZIP rendering', async () => {
  const options = { size: { mode: 'original' }, numbering: 'project', format: 'jpeg', quality: 85 }
  const jobs = planImageExport([page('a'), page('b')], { scope: 'all' }, options)
  assert.deepEqual(jobs.map(job => job.filename), ['001-同名_截图.jpg', '002-同名_截图.jpg'])
  const output = await buildAnnotatedImages('t', jobs, async (source, start, task, dimensions, encoding) => {
    assert.deepEqual(encoding, { format: 'jpeg', quality: 85 }); return new Blob([source.id], { type: 'image/jpeg' })
  })
  const zip = await JSZip.loadAsync(await output.blob.arrayBuffer(), { checkCRC32: true })
  assert.deepEqual(Object.keys(zip.files), jobs.map(job => job.filename))
  for (const quality of [0, 101, 90.5, NaN, Infinity]) assert.throws(() => planImageExport([page('a')], { scope: 'all' }, { ...options, quality }), /质量/)
  assert.throws(() => planImageExport([page('a')], { scope: 'all' }, { ...options, format: 'gif' }), /格式/)
})

test('image sizes preserve aspect ratio, round pixels and never upscale', () => {
  assert.deepEqual(imageExportDimensions(321, 181, { mode: 'percent', value: 50 }), { width: 161, height: 91 })
  assert.deepEqual(imageExportDimensions(240, 140, { mode: 'maxWidth', value: 160 }), { width: 160, height: 93 })
  assert.deepEqual(imageExportDimensions(240, 140, { mode: 'maxWidth', value: 1920 }), { width: 240, height: 140 })
  assert.deepEqual(imageExportDimensions(1, 1, { mode: 'percent', value: 1 }), { width: 1, height: 1 })
  for (const value of [0, -1, 101, NaN, Infinity]) assert.throws(() => imageExportDimensions(100, 80, { mode: 'percent', value }), /比例/)
  for (const value of [0, 1.5, 32769, NaN, Infinity]) assert.throws(() => imageExportDimensions(100, 80, { mode: 'maxWidth', value }), /宽度/)
  assert.throws(() => imageExportDimensions(1.5, 80, { mode: 'original' }), /尺寸无效/)
})

test('per-image numbers and output dimensions reach rendering without changing source pages', async () => {
  const pages = [page('a'), page('b')]
  pages[0].annotations = [numbered('first')]
  pages[1].annotations = [numbered('second')]
  const jobs = planImageExport(pages, { scope: 'selected', ids: ['b'] }, { size: { mode: 'percent', value: 50 }, numbering: 'per-image' })
  assert.equal(jobs[0].numberStart, 0)
  assert.equal(jobs[0].filename, '002-同名_截图.png')
  await buildAnnotatedImages('t', jobs, async (source, start, task, dimensions) => {
    assert.equal(source.width, 100); assert.equal(source.annotations[0].id, 'second'); assert.equal(start, 0)
    assert.deepEqual(dimensions, { width: 50, height: 40 })
    return new Blob(['png'])
  })
  assert.equal(pages[1].width, 100)
  assert.equal(planImageExport(pages, { scope: 'selected', ids: ['b'] })[0].numberStart, 1)
  assert.throws(() => planImageExport(pages, { scope: 'all' }, { size: { mode: 'original' }, numbering: 'unknown' }), /序号/)
})

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
  }), error => { assert.deepEqual(error.image, { index: 1, name: '同名/截图.png' }); return /第 2 张.*decode failed/.test(error.message) })
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

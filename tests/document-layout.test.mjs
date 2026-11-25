import test from 'node:test'
import assert from 'node:assert/strict'
import { documentRows, DEFAULT_DOCUMENT_HEADER, stepHeadingParts } from '../src/lib/document-layout.ts'
import { projectContentHash } from '../src/lib/project-content.ts'
import { DEFAULT_EXPORT_STYLE, DEFAULT_EXPORT_FOOTER } from '../src/types/index.ts'

test('document rows preserve identity, sequence and incomplete rows without changing source pages', () => {
  const pages = Array.from({ length: 7 }, (_, i) => ({ id: i }))
  for (const [layout, sizes] of [['top', [1,1,1,1,1,1,1]], ['left', [1,1,1,1,1,1,1]], ['right', [1,1,1,1,1,1,1]], ['two', [2,2,2,1]], ['three', [3,3,1]], ['shared', [2,2,2,1]]]) {
    const rows = documentRows(pages, layout)
    assert.deepEqual(rows.map(row => row.length), sizes)
    rows.flat().forEach((page, index) => assert.equal(page, pages[index]))
  }
  assert.deepEqual(documentRows([], 'three'), [])
})
test('file synchronization detects document layout, subtitle, background and logo changes', async () => {
  const data = { title: '标题', pages: [], exportStyle: DEFAULT_EXPORT_STYLE, exportFooter: DEFAULT_EXPORT_FOOTER }
  const baseline = await projectContentHash(data)
  for (const change of [
    { stepHeading: 'circle', stepColor: '#123456' },
    { layout: 'three' }, { layout: 'left', textWidth: 30 },
    { header: { ...DEFAULT_DOCUMENT_HEADER, subtitle: '副标题' } },
    { header: { ...DEFAULT_DOCUMENT_HEADER, background: 'color', color: '#334455' } },
    { header: { ...DEFAULT_DOCUMENT_HEADER, image: 'data:image/png;base64,background' } },
    { header: { ...DEFAULT_DOCUMENT_HEADER, logo: 'data:image/png;base64,logo' } },
  ]) {
    assert.notEqual(await projectContentHash({ ...data, exportStyle: { ...DEFAULT_EXPORT_STYLE, ...change } }), baseline)
  }
  assert.equal(await projectContentHash(structuredClone(data)), baseline)
})

test('step heading styles retain numbers, names and shared ranges without duplicate numbers', () => {
  assert.deepEqual(stepHeadingParts(0, 1, '打开首页', DEFAULT_EXPORT_STYLE), { kind: 'text', number: '1', label: '步骤' })
  assert.deepEqual(stepHeadingParts(99, 1, '打开首页', { ...DEFAULT_EXPORT_STYLE, stepHeading: 'circle' }), { kind: 'circle', number: '100', label: '打开首页' })
  assert.deepEqual(stepHeadingParts(2, 2, '不重复的名称', { ...DEFAULT_EXPORT_STYLE, stepHeading: 'badge' }), { kind: 'badge', number: '3–4', label: '步骤' })
  assert.equal(stepHeadingParts(2, 2, '单图名称', { ...DEFAULT_EXPORT_STYLE, stepHeading: 'circle' }).label, '操作步骤')
})

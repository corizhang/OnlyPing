import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { extractLegacyProjects, makeLegacyRecoveryZip } from '../src/lib/storage-recovery.ts'
const image = 'data:image/png;base64,eA=='
const data = { projectId: 'p', title: '旧存档', pages: [{ id: 's', image: 'asset:a', width: 10, height: 10, annotations: [], orig: { image: 'asset:a', width: 10, height: 10, annotations: [] } }] }
const validate = value => value?.pages?.[0]?.image === image ? structuredClone(value) : null

test('legacy extraction is readonly, retains original crops and reports missing assets', () => {
  const snapshot = { records: [['project:p', data], ['history:project:p', [data]], ['deleted:project:old', true], ['broken', { pages: [{ image: 'asset:missing' }] }]], assets: [['asset:a', image]] }
  const before = structuredClone(snapshot)
  const result = extractLegacyProjects(snapshot, validate)
  assert.equal(result.projects.length, 2)
  assert.equal(result.projects[0].data.pages[0].orig.image, image)
  assert.equal(result.failures[0].reason, '图片资源缺失')
  assert.deepEqual(snapshot, before)
})

test('recovery ZIP contains raw records, importable projects and a complete failure report', async () => {
  const snapshot = { records: [['project:p', data], ['bad', null]], assets: [['asset:a', image]] }
  const result = await makeLegacyRecoveryZip(snapshot, validate, '{broken')
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
  assert.equal(result.count, 1)
  assert.equal(result.failed, 2)
  assert.equal(JSON.parse(await zip.file('projects/0001.json').async('string')).pages[0].image, image)
  assert.deepEqual(JSON.parse(await zip.file('snapshot.json').async('string')).records, snapshot.records)
  assert.equal(await zip.file('legacy-localstorage.txt').async('string'), '{broken')
  assert.equal(JSON.parse(await zip.file('report.json').async('string')).failures.length, 2)
})

test('valid legacy localStorage project is also exported without modifying its text', async () => {
  const value = { ...data, pages: [{ ...data.pages[0], image }] }
  const raw = JSON.stringify(value)
  const result = await makeLegacyRecoveryZip({ records: [], assets: [] }, validate, raw)
  const zip = await JSZip.loadAsync(await result.blob.arrayBuffer())
  assert.equal(result.count, 1)
  assert.equal(await zip.file('legacy-localstorage.txt').async('string'), raw)
  assert.equal(JSON.parse(await zip.file('report.json').async('string')).recovered[0].source, 'localStorage:mbz-autosave')
})

test('an empty source still produces an honest recoverable raw snapshot', async () => {
  const result = await makeLegacyRecoveryZip({ records: [], assets: [] }, validate)
  assert.equal(result.count, 0)
  assert.equal(result.failed, 0)
})

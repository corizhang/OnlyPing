import test from 'node:test'
import assert from 'node:assert/strict'
import { projectContentHash } from '../src/lib/project-content.ts'
import { createProjectFileSession } from '../src/lib/project-files.ts'
const project = () => ({ projectId: 'p', title: '项目', pages: [{ id: 'page', name: '图片', image: 'data:image/png;base64,x', annotations: [], width: 100, height: 80, notes: '' }], exportStyle: { title: 32, heading: 22 }, exportFooter: { org: '', version: '', showDate: false } })
test('content comparison ignores JSON property order, identity and save timestamps but detects real changes', async () => {
  const first = project(), hash = await projectContentHash(first)
  const clone = { savedAt: 999, ...structuredClone(first), projectId: 'copy', exportStyle: { heading: 22, title: 32 } }
  assert.equal(await projectContentHash(clone), hash)
  assert.equal(await projectContentHash({ ...clone, exportStyle: { ...clone.exportStyle, imageScale: 100 } }), hash)
  for (const mutate of [p => p.title += 'x', p => p.pages[0].notes += 'x', p => p.pages[0].image += 'x', p => p.pages[0].annotations.push({ kind: 'text', text: '新文字' }), p => p.exportFooter.showDate = true]) {
    const changed = structuredClone(first); mutate(changed)
    assert.notEqual(await projectContentHash(changed), hash)
  }
})
function fixture() {
  const disk = project(), entry = { path: 'D:/项目.json', hash: 'disk-hash' }
  const host = { lookup: async () => entry, snapshot: async () => ({ ...entry, data: disk }), version: async () => entry.hash, open: async () => null, save: async () => null, read: async () => new Uint8Array(), write: async () => 'disk-hash' }
  return { disk, entry, host, session: createProjectFileSession(host) }
}
test('restart and undo to equal content become saved after checking without writing to disk', async () => {
  const f = fixture(); await f.session.restore('p')
  const restored = structuredClone(f.disk); await f.session.check('p', restored)
  assert.equal(f.session.dirty('p', restored), false); assert.equal(f.session.status('p', restored), 'saved')
  const edited = { ...restored, title: '改变标题' }; await f.session.check('p', edited)
  assert.equal(f.session.status('p', edited), 'dirty')
  const undo = structuredClone(f.disk); await f.session.check('p', undo)
  assert.equal(f.session.status('p', undo), 'saved')
  const stale = { ...undo, pages: [{ ...undo.pages[0], image: 'slow-image'.repeat(262144) }] }
  await Promise.all([f.session.check('p', stale), f.session.check('p', undo)])
  assert.equal(f.session.status('p', undo), 'saved', 'late older checks cannot replace the latest checked content')
})
test('external change and unavailable file never masquerade as synchronized', async () => {
  const f = fixture(); f.host.snapshot = async () => ({ ...f.entry, hash: 'external', data: f.disk })
  await f.session.restore('p'); await f.session.check('p', f.disk)
  assert.equal(f.session.status('p', f.disk), 'external'); assert.equal(f.session.dirty('p', f.disk), true)
  f.host.version = async () => null; await f.session.refreshDisk('p'); assert.equal(f.session.status('p', f.disk), 'unavailable')
  const second = fixture(); second.host.snapshot = async () => { throw Error('permission denied') }; await second.session.restore('p')
  assert.equal(second.session.status('p', second.disk), 'unavailable')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createProjectFileSession } from '../src/lib/project-files.ts'
const data = { projectId: 'p', title: '项目', pages: [], exportStyle: {}, exportFooter: {} }
function fixture() {
  const calls = [], records = new Map(), disk = new Map()
  const host = {
    open: async () => null, read: async () => new Uint8Array(), save: async () => { calls.push('picker'); return 'D:/other/copy.json' },
    managedSave: async (project, contents) => { calls.push('managed'); const entry = { path: 'D:/default/项目-p.json', hash: 'v1' }; records.set(project.projectId, entry); disk.set(entry.path, contents); return entry },
    version: async path => disk.has(path) ? records.get('p')?.hash ?? null : null,
    write: async (path, contents, expected) => { calls.push(['write', path, expected]); if (!disk.has(path) && expected) throw Error('deleted'); disk.set(path, contents); return 'v2' },
    remember: async (project, path, hash) => { calls.push('remember'); records.set(project.projectId, { path, hash }) },
    lookup: async id => records.get(id) ?? null,
  }
  return { host, calls, records, disk }
}
test('default first save bypasses picker; subsequent and restarted sessions reuse native binding', async () => {
  const f = fixture(), first = createProjectFileSession(f.host)
  assert.equal(await first.save(data), 'D:/default/项目-p.json')
  assert.deepEqual(f.calls, ['managed'])
  await first.save({ ...data, title: '改名' })
  assert.equal(f.calls.includes('picker'), false)
  const restarted = createProjectFileSession(f.host)
  await restarted.restore('p')
  assert.equal(restarted.binding('p').path, 'D:/default/项目-p.json')
  assert.equal(restarted.dirty('p', data), true, 'recovered draft is conservatively pending until saved')
  await restarted.save(data)
  assert.equal(f.calls.filter(v => v === 'managed').length, 1)
  assert.equal(restarted.dirty('p', data), false)
})
test('save-as uses picker and updates remembered binding; deleting a bound file cannot silently create another', async () => {
  const f = fixture(), session = createProjectFileSession(f.host)
  await session.save(data); await session.save(data, true)
  assert.equal(session.binding('p').path, 'D:/other/copy.json')
  assert.equal(f.records.get('p').path, 'D:/other/copy.json')
  f.disk.delete('D:/other/copy.json')
  await assert.rejects(session.save(data), /deleted/)
  assert.equal(session.binding('p').path, 'D:/other/copy.json')
})
test('failed default save leaves no binding and restore never trusts UI persisted paths', async () => {
  const f = fixture(); f.host.managedSave = async () => { throw Error('directory unavailable') }
  const session = createProjectFileSession(f.host)
  await assert.rejects(session.save(data), /unavailable/)
  assert.equal(session.binding('p'), undefined)
  await session.restore('unknown'); assert.equal(session.binding('unknown'), undefined)
})

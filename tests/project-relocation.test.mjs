import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectProjectRelocation } from '../src/lib/project-relocation.ts'
import { createProjectFileSession } from '../src/lib/project-files.ts'

const project = { projectId: 'p', title: '项目', pages: [], exportStyle: {}, exportFooter: {} }
const source = (contents = JSON.stringify(project)) => ({ path: 'D:/新位置/项目.json', hash: 'new-hash', file: new File([contents], '项目.json') })
const previous = { path: 'D:/原位置/项目.json', hash: 'old-hash' }
const validate = value => value && Array.isArray(value.pages) ? value : null

test('relocation inspection accepts BOM and rejects a different identity, corrupt or oversized file without registering', async () => {
  assert.equal((await inspectProjectRelocation(source('\uFEFF' + JSON.stringify(project)), 'p', validate)).projectId, 'p')
  await assert.rejects(inspectProjectRelocation(source(JSON.stringify({ ...project, projectId: 'other' })), 'p', validate), /不是同一个项目/)
  await assert.rejects(inspectProjectRelocation(source('invalid'), 'p', validate), /不是有效/)
  await assert.rejects(inspectProjectRelocation(source('{}'), 'p', validate), /格式无效/)
  const huge = { ...source(), file: { size: 512 * 1024 * 1024 + 1, text: () => { throw Error('must not read') } } }
  await assert.rejects(inspectProjectRelocation(huge, 'p', validate), /512 MiB/)
})

test('relocation registers before replacing the binding and uses picked file as the saved baseline', async () => {
  const calls = []
  const host = { open: async () => null, save: async () => null, read: async () => new Uint8Array(), version: async () => 'new-hash', write: async () => 'written', relocate: async (...args) => { calls.push(args) } }
  const session = createProjectFileSession(host)
  session.bind('p', { ...source(), ...previous }, project)
  const file = { ...project, title: '磁盘新标题' }
  await session.relocate('p', source(), file, previous)
  assert.equal(calls.length, 1); assert.deepEqual(calls[0][2], previous)
  assert.equal(session.binding('p').path, source().path)
  assert.equal(session.status('p', file), 'saved')
  await session.check('p', project)
  assert.equal(session.status('p', project), 'dirty', 'restoring a different draft remains pending')
})

test('failed or mismatched relocation preserves the old binding; queued saves use confirmed location', async () => {
  let reject = true
  const writes = []
  const host = { open: async () => null, save: async () => null, read: async () => new Uint8Array(), version: async () => 'new-hash', write: async path => { writes.push(path); return 'written' }, relocate: async () => { if (reject) throw Error('candidate changed') } }
  const session = createProjectFileSession(host)
  session.bind('p', { ...source(), ...previous }, project)
  await assert.rejects(session.relocate('p', source(), project, previous), /candidate changed/)
  assert.equal(session.binding('p').path, previous.path)
  await assert.rejects(session.relocate('p', source(), { ...project, projectId: 'other' }, previous), /不是同一个项目/)
  reject = false
  await Promise.all([session.relocate('p', source(), project, previous), session.save(project)])
  assert.deepEqual(writes, [source().path])
})

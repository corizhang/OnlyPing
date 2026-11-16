import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createProjectFileSession } from '../src/lib/project-files.ts'

const digest = text => createHash('sha256').update(text).digest('hex')
const project = (id = 'p', title = '中文项目') => ({ projectId: id, schemaVersion: 1, title, pages: [], exportStyle: { title: 32 }, exportFooter: { org: '', version: '', showDate: false }, savedAt: 123 })
const key = path => path.replaceAll('\\', '/').toLowerCase()
function fixture() {
  const f = { files: new Map(), calls: [], choice: 'D:/选定/项目.json', openPath: null, gate: null }
  const host = {
    open: async () => f.openPath,
    save: async name => { f.calls.push(['pick', name]); return f.choice },
    read: async path => new TextEncoder().encode(f.files.get(key(path))),
    version: async path => { f.calls.push(['version', path]); return f.files.has(key(path)) ? digest(f.files.get(key(path))) : null },
    write: async (path, contents, expected) => {
      f.calls.push(['write', path, contents, expected])
      if (f.gate) await f.gate
      const actual = f.files.has(key(path)) ? digest(f.files.get(key(path))) : null
      if (actual !== expected) throw Error('external conflict')
      f.files.set(key(path), contents)
      return digest(contents)
    },
  }
  f.session = createProjectFileSession(host)
  return f
}

test('first save picks a file, subsequent save reuses it and writes no filesystem metadata into JSON', async () => {
  const f = fixture(), data = project()
  await f.session.save(data)
  const next = { ...data, title: '已修改' }
  assert.equal(f.session.dirty('p', next), true)
  await f.session.save(next)
  assert.equal(f.calls.filter(c => c[0] === 'pick').length, 1)
  assert.equal(f.session.dirty('p', next), false)
  const saved = JSON.parse(f.files.get(key(f.choice)))
  assert.equal(saved.savedAt, undefined)
  assert.equal(saved.path, undefined)
  assert.equal(saved.title, '已修改')
})

test('save-as and open cancellation never replace an existing binding', async () => {
  const f = fixture(), data = project()
  await f.session.save(data)
  const old = f.session.binding('p')
  f.choice = null
  assert.equal(await f.session.save({ ...data, title: '取消' }, true), null)
  assert.equal(f.session.binding('p'), old)
  assert.equal(await f.session.open(), null)
  assert.equal(f.session.binding('p'), old)
})

test('opening hashes exactly the bytes read, and binding is explicit after validation', async () => {
  const f = fixture()
  f.openPath = f.choice
  const contents = JSON.stringify(project())
  f.files.set(key(f.choice), contents)
  const source = await f.session.open()
  assert.equal(source.hash, digest(contents))
  assert.equal(await source.file.text(), contents)
  assert.equal(f.session.binding('p'), undefined)
  const data = project()
  f.session.bind('p', source, data)
  assert.equal(f.session.dirty('p', data), false)
  f.files.set(key(f.choice), 'external')
  await assert.rejects(f.session.save({ ...data, title: '修改' }), /conflict/)
  assert.equal(f.files.get(key(f.choice)), 'external')
  assert.equal(f.session.binding('p').hash, digest(contents))
})

test('save-as to the same Windows path does not bypass external modification detection', async () => {
  const f = fixture(), data = project()
  f.choice = 'D:/Folder/Project.json'
  await f.session.save(data)
  f.files.set(key(f.choice), 'external')
  f.choice = 'd:\\folder\\project.json'
  await assert.rejects(f.session.save({ ...data, title: '修改' }, true), /conflict/)
  assert.equal(f.files.get(key(f.choice)), 'external')
})

test('successful save-as switches only that project to its new destination', async () => {
  const f = fixture(), data = project()
  await f.session.save(data)
  const original = f.choice
  f.choice = 'D:/选定/新文件.json'
  await f.session.save(data, true)
  assert.equal(f.session.binding('p').path, f.choice)
  assert.ok(f.files.has(key(original)))
  assert.equal(f.session.binding('other'), undefined)
})

test('edits made during an in-flight save remain dirty after that snapshot is written', async () => {
  const f = fixture(), first = project()
  let release
  f.gate = new Promise(resolve => { release = resolve })
  const saving = f.session.save(first)
  const latest = { ...first, title: '保存过程中继续修改' }
  release()
  await saving
  assert.equal(f.session.dirty('p', latest), true)
  assert.equal(JSON.parse(f.files.get(key(f.choice))).title, first.title)
})

test('serialized saves use the latest successful file hash and a new session has no permission binding', async () => {
  const f = fixture(), first = project()
  await Promise.all([f.session.save(first), f.session.save({ ...first, title: '后写入' })])
  assert.equal(JSON.parse(f.files.get(key(f.choice))).title, '后写入')
  assert.equal(f.calls.filter(c => c[0] === 'pick').length, 1)
  assert.equal(fixture().session.binding('p'), undefined)
})

test('saving invalid project identity never opens a picker or touches files', async () => {
  const f = fixture()
  await assert.rejects(f.session.save({ ...project(), projectId: undefined }), /缺少标识/)
  assert.deepEqual(f.calls, [])
})

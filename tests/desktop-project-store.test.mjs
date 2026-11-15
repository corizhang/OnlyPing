import test from 'node:test'
import assert from 'node:assert/strict'
import { createDesktopProjectStore } from '../src/lib/desktop-project-store.ts'

const image = 'data:image/png;base64,eA=='
const data = (title = '测试项目') => ({ projectId: 'p', title, pages: [{ id: 's', image, width: 10, height: 10, annotations: [] }] })
const validate = value => value?.pages?.every(p => p.image.startsWith('data:image/')) ? structuredClone(value) : null

function fixture(options = {}) {
  const calls = []
  let legacyReads = 0, initialized = options.ready ?? false
  const assets = new Set()
  const invoke = async (command, args) => {
    calls.push({ command, args })
    if (options.intercept) { const result = await options.intercept(command, args); if (result !== undefined) return result }
    if (command === 'project_storage_ready') return initialized
    if (command === 'project_storage_migrate') { initialized = true; return }
    if (command === 'project_storage_list') return []
    if (command === 'project_storage_read') return { value: data(), version: 7, projectKey: 'project:p' }
    if (command === 'project_storage_missing_assets') return args.keys.filter(k => !assets.has(k))
    if (command === 'project_storage_save') { for (const [key] of args.assets) assets.add(key); return 8 }
  }
  const store = createDesktopProjectStore(invoke, async () => { legacyReads++; return options.snapshot ?? { records: [], assets: [] } }, validate)
  return { store, calls, legacyReads: () => legacyReads }
}

test('desktop initializes once before reads and preserves the source snapshot', async () => {
  const snapshot = { records: [['project:p', data()], ['history:project:p', [data('历史')]], ['deleted:project:old', true]], assets: [] }
  const original = structuredClone(snapshot)
  const f = fixture({ snapshot })
  await Promise.all([f.store.read(), f.store.list()])
  assert.equal(f.legacyReads(), 1)
  assert.deepEqual(snapshot, original)
  assert.equal(f.calls.filter(c => c.command === 'project_storage_migrate').length, 1)
  assert.equal(f.calls[1].command, 'project_storage_migrate')
})

test('completed migration never reads obsolete IndexedDB source again', async () => {
  const f = fixture({ ready: true })
  await f.store.read()
  assert.equal(f.legacyReads(), 0)
  assert.ok(!f.calls.some(c => c.command === 'project_storage_migrate'))
})

test('invalid source assets prevent migration and saving without modifying source', async () => {
  const broken = data(); broken.pages[0].image = 'asset:missing'
  const f = fixture({ snapshot: { records: [['autosave', broken]], assets: [] } })
  await assert.rejects(f.store.read(), /迁移已停止/)
  await assert.rejects(f.store.save(data()), /迁移已停止/)
  assert.equal(f.legacyReads(), 2)
  assert.ok(!f.calls.some(c => c.command === 'project_storage_save' || c.command === 'project_storage_migrate'))
  assert.equal(broken.pages[0].image, 'asset:missing')
})

test('failed native migration can retry and never falls back to writing IndexedDB', async () => {
  let failed = true
  const f = fixture({ intercept: command => { if (command === 'project_storage_migrate' && failed) throw Error('disk full') } })
  await assert.rejects(f.store.read(), /disk full/)
  failed = false
  await f.store.read()
  assert.equal(f.legacyReads(), 2)
})

test('metadata edits send only missing image bytes and carry observed versions', async () => {
  const f = fixture({ ready: true })
  await f.store.read()
  const first = data()
  first.pages[0].orig = { image, width: 10, height: 10, annotations: [] }
  await f.store.save(first)
  await f.store.save({ ...first, title: '更名' })
  const saves = f.calls.filter(c => c.command === 'project_storage_save').map(c => c.args)
  assert.equal(saves[0].expectedVersion, 7)
  assert.equal(saves[1].expectedVersion, 8)
  assert.equal(saves[0].assets.length, 1)
  assert.equal(saves[1].assets.length, 0)
  assert.equal(saves[0].data.pages[0].image, saves[0].data.pages[0].orig.image)
  assert.ok(saves[0].data.pages[0].image.startsWith('asset:'))
  assert.equal(first.pages[0].image, image)
})

test('save failure keeps observed version and queue remains usable', async () => {
  let failed = true
  const f = fixture({ ready: true, intercept: command => { if (command === 'project_storage_save' && failed) throw Error('conflict') } })
  await f.store.read()
  await assert.rejects(f.store.save(data()), /conflict/)
  failed = false
  await f.store.save(data('重试'))
  const saves = f.calls.filter(c => c.command === 'project_storage_save')
  assert.equal(saves[1].args.expectedVersion, 7)
  await assert.rejects(f.store.save(null), /无效数据/)
  await assert.rejects(f.store.remove('autosave'), /无效项目/)
})

test('operations preserve save/delete ordering', async () => {
  const f = fixture({ ready: true })
  await Promise.all([f.store.save(data()), f.store.remove('project:p')])
  const names = f.calls.map(c => c.command)
  assert.ok(names.indexOf('project_storage_save') < names.indexOf('project_storage_delete'))
})

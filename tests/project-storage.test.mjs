import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@/types') return { url: new URL('../src/types/index.ts', import.meta.url).href, shortCircuit: true }
  return next(specifier, context)
} })
const { idbGet, idbSet, listLocalProjects, readLocalProject } = await import('../src/lib/db.ts')
const image = 'data:image/png;base64,aGVsbG8='
const project = (projectId, title, savedAt = 1) => ({ schemaVersion: 1, projectId, title, savedAt,
  pages: [{ id: 'page', name: '截图', notes: '', image, width: 100, height: 100, annotations: [] }] })
const open = () => new Promise((resolve, reject) => { const req = indexedDB.open('mingbai-tool', 2); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })

test('project storage preserves projects, history and resources through round trips', async () => {
  await idbSet(project('a', '第一版'))
  await idbSet(project('a', '第二版', 2))
  await idbSet(project('b', '另一个项目', 3))
  assert.equal((await idbGet()).projectId, 'b')
  const entries = await listLocalProjects()
  const latest = entries.find(e => e.key === 'project:a')
  const previous = entries.find(e => e.key === 'history:project:a')
  assert.equal((await readLocalProject(latest)).title, '第二版')
  const restored = await readLocalProject(previous)
  assert.equal(restored.title, '第一版')
  assert.equal(restored.pages[0].image, image)
  const db = await open()
  const count = await new Promise(resolve => { const req = db.transaction('images').objectStore('images').count(); req.onsuccess = () => resolve(req.result) })
  db.close()
  assert.equal(count, 1, 'identical images are stored once across projects and revisions')
})

test('unchanged writes do not rotate backups; history retains three distinct revisions', async () => {
  await idbSet(project('a', '第二版', 20))
  let entries = await listLocalProjects()
  assert.equal(entries.filter(e => e.key === 'history:project:a').length, 1)
  for (let i = 3; i <= 7; i++) await idbSet(project('a', `第${i}版`, i))
  entries = await listLocalProjects()
  assert.equal(entries.filter(e => e.key === 'history:project:a').length, 3)
})

test('invalid saves reject without replacing the current autosave; subsequent writes recover', async () => {
  const before = await idbGet()
  await assert.rejects(idbSet({ pages: [{ width: -1 }] }))
  assert.equal((await idbGet()).title, before.title)
  await idbSet(project('c', '恢复正常写入'))
  assert.equal((await idbGet()).title, '恢复正常写入')
})

test('queued writes preserve ordering and original crop images survive storage', async () => {
  const cropped = project('crop', '裁剪')
  cropped.pages[0].orig = { image, width: 100, height: 100, annotations: [] }
  await Promise.all([idbSet(cropped), idbSet(project('last', '最后提交'))])
  assert.equal((await idbGet()).title, '最后提交')
  const saved = await idbGet('project:crop')
  assert.equal(saved.pages[0].orig.image, image)
})

test('images discarded from every retained revision are collected', async () => {
  const firstImage = 'data:image/png;base64,' + Buffer.from('gc-1').toString('base64')
  for (let i = 1; i <= 6; i++) {
    const data = project('gc', `版本${i}`, i)
    data.pages[0].image = 'data:image/png;base64,' + Buffer.from(`gc-${i}`).toString('base64')
    await idbSet(data)
  }
  const db = await open()
  const images = await new Promise(resolve => { const req = db.transaction('images').objectStore('images').getAll(); req.onsuccess = () => resolve(req.result) })
  db.close()
  assert.ok(!images.includes(firstImage))
  const history = (await listLocalProjects()).filter(e => e.key === 'history:project:gc')
  for (const entry of history) assert.ok((await readLocalProject(entry)).pages[0].image.startsWith('data:image/'))
})

test('a stale browser tab cannot overwrite newer project changes', async () => {
  const otherTab = await import('../src/lib/db.ts?other-tab')
  await idbSet(project('conflict', '原始内容'))
  await otherTab.idbGet('project:conflict')
  await idbSet(project('conflict', '新的修改', 2))
  await assert.rejects(otherTab.idbSet(project('conflict', '旧页面修改', 3)), /其他页面修改/)
  assert.equal((await idbGet('project:conflict')).title, '新的修改')
})

test('locked and hidden flags survive project validation and storage', async () => {
  const data = project('flags', '标注状态')
  data.pages[0].annotations = [{ id: 'box', kind: 'box', x: 0, y: 0, w: 20, h: 20, color: '#ff0000', locked: true, hidden: true }]
  await idbSet(data)
  const restored = await idbGet('project:flags')
  assert.equal(restored.pages[0].annotations[0].locked, true)
  assert.equal(restored.pages[0].annotations[0].hidden, true)
})

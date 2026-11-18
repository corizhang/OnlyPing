import 'fake-indexeddb/auto'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@/types') return { url: new URL('../src/types/index.ts', import.meta.url).href, shortCircuit: true }
  return next(specifier, context)
} })
const { idbGet, idbSet, listLocalProjects, readLocalProject, deleteLocalProject, readIndexedDBSnapshot } = await import('../src/lib/db.ts')
const image = 'data:image/png;base64,aGVsbG8='
const project = (projectId, title, savedAt = 1) => ({ schemaVersion: 1, projectId, title, savedAt,
  pages: [{ id: 'page', name: '截图', notes: '', image, width: 100, height: 100, annotations: [] }] })
const open = () => new Promise((resolve, reject) => { const req = indexedDB.open('mingbai-tool', 2); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })

test('readonly migration of a version-1 source never upgrades its schema', async () => {
  const previous = globalThis.indexedDB
  globalThis.indexedDB = new IDBFactory()
  try {
    const db = await new Promise(resolve => {
      const req = indexedDB.open('mingbai-tool', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('projects')
      req.onsuccess = () => resolve(req.result)
    })
    await new Promise(resolve => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(project('v1', '旧版本'), 'autosave'); tx.oncomplete = resolve })
    db.close()
    const snapshot = await readIndexedDBSnapshot()
    assert.equal(snapshot.records[0][1].title, '旧版本')
    assert.equal(snapshot.assets.length, 0)
    assert.equal((await indexedDB.databases())[0].version, 1)
  } finally { globalThis.indexedDB = previous }
})

test('readonly recovery of an absent source does not leave an empty database behind', async () => {
  const previous = globalThis.indexedDB
  globalThis.indexedDB = new IDBFactory()
  try {
    assert.deepEqual(await readIndexedDBSnapshot(), { records: [], assets: [] })
    assert.deepEqual(await indexedDB.databases(), [])
  } finally { globalThis.indexedDB = previous }
})

test('migration snapshot preserves source aliases, history, tombstones and assets without writes', async () => {
  const value = project('migration-source', '迁移原始')
  await idbSet(value)
  await idbSet({ ...value, title: '迁移第二版' })
  const before = await idbGet()
  const snapshot = await readIndexedDBSnapshot()
  const records = new Map(snapshot.records)
  assert.ok(records.has('project:migration-source'))
  assert.ok(records.has('history:project:migration-source'))
  const key = records.get('autosave').pages[0].image
  assert.equal(new Map(snapshot.assets).get(key), image)
  assert.deepEqual(await idbGet(), before)
  await deleteLocalProject('project:migration-source')
  assert.equal(new Map((await readIndexedDBSnapshot()).records).get('deleted:project:migration-source'), true)
})

test('metadata edits reuse stored images and recreate missing assets without trusting a stale cache', async () => {
  const data = project('asset-reuse', '原始名称')
  data.pages = Array.from({ length: 30 }, (_, i) => ({ ...data.pages[0], id: `p${i}`, image: image + `asset-${i}` }))
  const original = IDBObjectStore.prototype.put
  let imageWrites = 0
  IDBObjectStore.prototype.put = function (...args) { if (this.name === 'images') imageWrites++; return original.apply(this, args) }
  try {
    await idbSet(data)
    assert.equal(imageWrites, 30)
    await idbSet({ ...data, pages: data.pages.map((p, i) => i ? p : { ...p, name: '只改名称' }) })
    assert.equal(imageWrites, 30, 'a name change cannot rewrite all screenshots')
    const db = await open()
    await new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite'), cursor = tx.objectStore('images').openCursor()
      cursor.onsuccess = () => { if (cursor.result?.value === data.pages[0].image) cursor.result.delete(); else cursor.result?.continue() }
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error)
    })
    db.close()
    await idbSet(data)
    assert.equal(imageWrites, 31, 'missing assets must be restored even when their hashes are cached')
    assert.equal((await idbGet()).pages[0].image, data.pages[0].image)
    await deleteLocalProject('project:asset-reuse')
  } finally { IDBObjectStore.prototype.put = original }
})

test('project deletion removes history and aliases but preserves shared image resources', async () => {
  const removed = project('delete-target', '删除对象')
  removed.pages[0].image = image + 'ZGVsZXRl'
  await idbSet(removed)
  const shared = project('delete-survivor', '保留对象')
  shared.pages[0].image = removed.pages[0].image
  await idbSet(shared)
  await idbSet({ ...removed, title: '第二版' })
  // Give only the deleted project's latest version an additional private image.
  const privateImage = image + 'cHJpdmF0ZQ=='
  await idbSet({ ...removed, title: '第三版', pages: [{ ...removed.pages[0], image: privateImage }] })
  await deleteLocalProject('project:delete-target')
  assert.equal(await idbGet(), null, 'deleted autosave cannot reopen on refresh')
  assert.equal(await idbGet('backup'), null)
  assert.equal(await idbGet('history:project:delete-target'), null)
  assert.ok(!(await listLocalProjects()).some(e => e.key.includes('delete-target')))
  const survivor = await readLocalProject({ key: 'project:delete-survivor' })
  assert.equal(survivor.pages[0].image, shared.pages[0].image)
  const db = await open()
  const values = await new Promise(resolve => { const req = db.transaction('images').objectStore('images').getAll(); req.onsuccess = () => resolve(req.result) })
  db.close()
  assert.ok(values.includes(shared.pages[0].image))
  assert.ok(!values.includes(privateImage))
  await assert.rejects(idbSet(removed), /已在其他页面删除/, 'a stale tab cannot resurrect the deleted project')
  await idbSet({ ...removed, projectId: 'delete-import-copy' })
  assert.equal((await idbGet()).projectId, 'delete-import-copy', 'a backup can be imported under a new identity')
  await deleteLocalProject('project:delete-import-copy')
  await deleteLocalProject('project:delete-survivor')
})

test('deletion serializes after pending saves and never deletes unrelated storage keys', async () => {
  const save = idbSet(project('delete-queued', '待保存'))
  const remove = deleteLocalProject('project:delete-queued')
  await Promise.all([save, remove])
  assert.equal(await idbGet('project:delete-queued'), null)
  await assert.rejects(deleteLocalProject('autosave'), /无效项目/)
  await idbSet(project('after-delete', '仍能保存'))
  assert.equal((await idbGet()).title, '仍能保存')
  await deleteLocalProject('project:after-delete')
})

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

test('shape variants and arrow contours survive storage while invalid styles reject without overwriting', async () => {
  const data = project('drawing-styles', '样式往返')
  data.pages[0].annotations = [
    { id: 'b', kind: 'box', x: 0, y: 0, w: 50, h: 40, color: '#ff0000', style: { width: 3, fill: 'solid', fillColor: '#00ff00', fillOpacity: .3, strokeStyle: 'dashed', radius: 12 } },
    { id: 'e', kind: 'ellipse', x: 20, y: 10, w: 40, h: 30, color: '#0000ff', style: { fill: 'solid', strokeStyle: 'none', fillOpacity: .5 } },
    { id: 'a', kind: 'arrow', x1: 0, y1: 0, x2: 90, y2: 60, color: '#ff0000', width: 6, arrowStyle: 'emphasis' },
    { id: 'old', kind: 'box', x: 1, y: 1, w: 10, h: 10, color: '#ff0000' },
  ]
  await idbSet(data)
  const restored = await idbGet('project:drawing-styles')
  assert.deepEqual(restored.pages[0].annotations, data.pages[0].annotations)
  const invalid = structuredClone(data); invalid.pages[0].annotations[0].style.fillOpacity = 2
  await assert.rejects(idbSet(invalid))
  assert.equal((await idbGet('project:drawing-styles')).pages[0].annotations[0].style.fillOpacity, .3)
})

test('text, callout, badge and highlighter styles persist without flattening or losing crop originals', async () => {
  const data = project('content-styles', '文本样式')
  const annotations = [
    { id: 't', kind: 'text', x: 10, y: 30, text: '第一行\n第二行', color: '#111827', size: 24, background: true, textStyle: { weight: 400, align: 'right', lineHeight: 1.5, outline: false, backgroundColor: '#fef08a', backgroundOpacity: .7, padding: 12, radius: 8 } },
    { id: 'c', kind: 'callout', x: 5, y: 5, w: 90, h: 50, text: '说明', color: '#2563eb', size: 18, textStyle: { align: 'left', padding: 12, radius: 8 } },
    { id: 'n', kind: 'number', x: 70, y: 70, r: 20, color: '#2563eb', badge: 'ring' },
    { id: 'h', kind: 'highlight', x: 0, y: 0, w: 80, h: 30, color: '#facc15', opacity: .25 },
  ]
  data.pages[0].annotations = annotations; data.pages[0].orig = { image, width: 100, height: 100, annotations }
  await idbSet(data)
  const restored = await idbGet('project:content-styles')
  assert.deepEqual(restored.pages[0].annotations, annotations); assert.deepEqual(restored.pages[0].orig.annotations, annotations)
  const invalid = structuredClone(data); invalid.pages[0].annotations[0].textStyle.lineHeight = 0
  await assert.rejects(idbSet(invalid))
  assert.equal((await idbGet('project:content-styles')).pages[0].annotations[0].textStyle.lineHeight, 1.5)
})

test('curved controls, callout targets and smooth strokes survive save and cropped original round trips', async()=>{
  const data=project('advanced-tools','高级工具')
  const annotations=[{id:'curve',kind:'arrow',x1:0,y1:0,x2:90,y2:30,color:'#ef4444',width:4,arrowStyle:'curved',control:{x:40,y:80}},{id:'bubble',kind:'callout',x:10,y:10,w:60,h:40,text:'提示',color:'#2563eb',tail:{x:90,y:90}},{id:'brush',kind:'freehand',points:[{x:0,y:0},{x:10,y:10},{x:20,y:0}],color:'#ef4444',smoothed:true}]
  data.pages[0].annotations=annotations;data.pages[0].orig={image,width:100,height:100,annotations}
  await idbSet(data);const restored=await idbGet('project:advanced-tools');assert.deepEqual(restored.pages[0].annotations,annotations);assert.deepEqual(restored.pages[0].orig.annotations,annotations)
  const invalid=structuredClone(data);invalid.pages[0].annotations[0].control.x=Infinity;await assert.rejects(idbSet(invalid));assert.equal((await idbGet('project:advanced-tools')).pages[0].annotations[0].control.x,40)
})

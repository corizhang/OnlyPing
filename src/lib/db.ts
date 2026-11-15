import { z } from 'zod'
import { DEFAULT_EXPORT_STYLE, DEFAULT_EXPORT_FOOTER } from '@/types'
import { ImageAssetCache } from './image-asset-cache.ts'
import { isDesktop } from './files.ts'
import type { LegacySnapshot } from './desktop-project-store.ts'
/** Web uses IndexedDB; desktop uses the transactional native store. */

let desktop: Promise<ReturnType<typeof import('./desktop-project-store.ts').createDesktopProjectStore>> | undefined
function nativeStore() {
  return desktop ??= import('./desktop-project-store.ts').then(({ createDesktopProjectStore }) =>
    createDesktopProjectStore(async (command, args) => {
      try { return await (await import('@tauri-apps/api/core')).invoke(command, args) }
      catch (error) {
        if ((error as { code?: string })?.code === 'conflict') throw new ProjectConflictError()
        throw new Error((error as { message?: string })?.message ?? '桌面存储不可用，请保留当前项目并下载备份')
      }
    }, readIndexedDBSnapshot, validateAutosave))
    .catch(error => { desktop = undefined; throw error })
}

/** One readonly transaction preserves aliases, history, tombstones and image references. */
export async function readIndexedDBSnapshot(): Promise<LegacySnapshot> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, 'images'], 'readonly')
    const records: LegacySnapshot['records'] = [], assets: LegacySnapshot['assets'] = []
    for (const [name, destination] of [[STORE, records], ['images', assets]] as const) {
      const cursor = tx.objectStore(name).openCursor()
      cursor.onsuccess = () => {
        const row = cursor.result
        if (row) { destination.push([String(row.key), row.value]); row.continue() }
      }
    }
    tx.oncomplete = () => { db.close(); resolve({ records, assets }) }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('旧存档读取失败，未迁移')) }
  })
}

const DB_NAME = 'mingbai-tool'
const STORE = 'projects'
const KEY = 'autosave'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
      if (!req.result.objectStoreNames.contains('images')) req.result.createObjectStore('images')
    }
    req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result) }
    req.onblocked = () => reject(new Error('请关闭其他 OnlyPing 页面后重试存储升级'))
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
  })
}

let writeQueue: Promise<void> = Promise.resolve()
const assetKeys = new ImageAssetCache()
const observedVersions = new Map<string, string>()
const fingerprint = (value: unknown) => JSON.stringify({ ...(value as object), savedAt: 0 })
export class ProjectConflictError extends Error {
  constructor() { super('此项目已在其他页面修改，请下载当前项目备份后重新打开本地项目') }
}

function pruneUnusedImages(tx: IDBTransaction) {
  const records = tx.objectStore(STORE).getAll()
  records.onsuccess = () => {
    const used = new Set<string>()
    for (const record of records.result.flat()) {
      for (const page of record?.pages ?? []) {
        used.add(page.image)
        if (page.orig) used.add(page.orig.image)
      }
    }
    const cursor = tx.objectStore('images').openKeyCursor()
    cursor.onsuccess = () => {
      const row = cursor.result
      if (!row) return
      if (!used.has(String(row.key))) tx.objectStore('images').delete(row.key)
      row.continue()
    }
  }
}

/** Deletion shares the save queue and transaction so history/assets cannot race. */
export function deleteLocalProject(key: string): Promise<void> {
  if (isDesktop()) return nativeStore().then(store => store.remove(key))
  if (!key.startsWith('project:') || key.length <= 8) return Promise.reject(new Error('无效项目'))
  const task = writeQueue.catch(() => undefined).then(async () => {
    const db = await openDB()
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, 'images'], 'readwrite')
      const store = tx.objectStore(STORE)
      store.delete(key)
      store.delete(`history:${key}`)
      store.put(true, `deleted:${key}`)
      for (const alias of [KEY, 'backup']) {
        const req = store.get(alias)
        req.onsuccess = () => {
          if (req.result && `project:${req.result.projectId ?? 'legacy'}` === key) store.delete(alias)
        }
      }
      // Queue the scan after alias callbacks have queued their deletions.
      const barrier = store.get(key)
      barrier.onsuccess = () => pruneUnusedImages(tx)
      tx.oncomplete = () => { observedVersions.delete(key); db.close(); resolve() }
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('删除失败，原项目仍保留')) }
    })
  })
  writeQueue = task
  return task
}

async function packImages(value: ProjectData, owners: ProjectData['pages']) {
  const assets = new Map<string, string>()
  const pack = async (image: string, owner: object) => {
    const key = await assetKeys.key(image, owner)
    assets.set(key, image)
    return key
  }
  const pages = []
  for (let i = 0; i < value.pages.length; i++) {
    const page = value.pages[i], owner = owners[i] ?? page
    pages.push({ ...page, image: await pack(page.image, owner), orig: page.orig ? { ...page.orig, image: await pack(page.orig.image, owner.orig ?? page.orig) } : undefined })
  }
  return { packed: { ...value, pages }, assets }
}

export function idbSet(value: unknown): Promise<void> {
  if (isDesktop()) return nativeStore().then(store => store.save(value))
  const valid = validateAutosave(value)
  if (!valid) return Promise.reject(new Error('项目包含无效数据，未覆盖存档'))
  // Capture identities separately: validation clones records, while immutable
  // React pages keep unchanged screenshot owners stable between edits.
  const owners = [...(value as ProjectData).pages]
  const task = writeQueue.catch(() => undefined).then(() => writeProject(valid, owners))
  writeQueue = task
  return task
}

async function writeProject(value: ProjectData, owners: ProjectData['pages']): Promise<void> {
  const { packed, assets } = await packImages(value, owners)
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, 'images'], 'readwrite')
    const store = tx.objectStore(STORE)
    const projectKey = `project:${value.projectId ?? 'legacy'}`
    const previous = store.get(projectKey)
    let conflict = false
    let deleted = false
    let failure: DOMException | null = null
    let committedVersion = ''
    const tombstone = store.get(`deleted:${projectKey}`)
    tombstone.onsuccess = () => { if (tombstone.result) { deleted = true; tx.abort() } }
    previous.onsuccess = () => {
      const old = previous.result
      const unchanged = old && fingerprint(old) === fingerprint(packed)
      if (old && !unchanged && observedVersions.get(projectKey) !== fingerprint(old)) {
        conflict = true
        tx.abort()
        return
      }
      committedVersion = fingerprint(unchanged ? old : packed)
      if (old && !unchanged) {
        store.put(old, 'backup')
        const revisions = store.get(`history:${projectKey}`)
        revisions.onsuccess = () => {
          store.put([old, ...(revisions.result ?? [])].slice(0, 3), `history:${projectKey}`)
          pruneUnusedImages(tx)
        }
      }
      for (const [key, image] of assets) {
        // Check in this transaction rather than trusting an in-memory existence
        // cache: another tab or resource cleanup may have removed the asset.
        const req = tx.objectStore('images').getKey(key)
        req.onsuccess = () => { if (req.result === undefined) tx.objectStore('images').put(image, key) }
      }
      store.put(unchanged ? old : packed, projectKey)
      store.put(unchanged ? old : packed, KEY)
      if (!old) pruneUnusedImages(tx)
    }
    tx.oncomplete = () => {
      observedVersions.set(projectKey, committedVersion)
      db.close()
      resolve()
    }
    // Aborting pending requests emits error events before the final abort event.
    // Preserve the original request failure, but settle only after rollback.
    tx.onerror = event => { failure = (event.target as IDBRequest).error ?? tx.error }
    tx.onabort = () => {
      db.close()
      reject(deleted ? new Error('此项目已在其他页面删除，请下载当前项目备份后作为新项目导入') : conflict ? new ProjectConflictError() : tx.error ?? failure ?? new Error('IndexedDB 写入被中止'))
    }
  })
}

export async function idbGet<T>(key = KEY): Promise<T | null> {
  if (isDesktop()) return (await nativeStore()).read<T>(key)
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, 'images'], 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => {
      const value = req.result
      if (value?.pages) {
        observedVersions.set(`project:${value.projectId ?? 'legacy'}`, fingerprint(value))
        for (const page of value.pages) {
          for (const image of [page, page.orig].filter(Boolean)) {
            if (typeof image.image === 'string' && image.image.startsWith('asset:')) {
              const asset = tx.objectStore('images').get(image.image)
              asset.onsuccess = () => { image.image = asset.result ?? '' }
            }
          }
        }
      }
      tx.oncomplete = () => { db.close(); resolve(value ?? null) }
    }
    req.onerror = () => {
      db.close()
      reject(req.error ?? new Error('IndexedDB 读取失败'))
    }
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('存档读取中止')) }
  })
}

export interface LocalProjectEntry { key: string; title: string; savedAt: number; pages: number; revision?: number }

export async function listLocalProjects(): Promise<LocalProjectEntry[]> {
  if (isDesktop()) return (await nativeStore()).list()
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const result: LocalProjectEntry[] = []
    const cursor = tx.objectStore(STORE).openCursor()
    cursor.onsuccess = () => {
      const row = cursor.result
      if (!row) return
      const key = String(row.key)
      if (key.startsWith('project:')) result.push({ key, title: row.value.title, savedAt: row.value.savedAt ?? 0, pages: row.value.pages.length })
      if (key.startsWith('history:project:')) row.value.forEach((p: ProjectData, revision: number) => result.push({ key, revision, title: p.title, savedAt: p.savedAt ?? 0, pages: p.pages.length }))
      row.continue()
    }
    tx.oncomplete = () => { db.close(); resolve(result.sort((a, b) => b.savedAt - a.savedAt)) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function readLocalProject(entry: LocalProjectEntry) {
  if (isDesktop()) {
    const value = await (await nativeStore()).read<unknown>(entry.key)
    return validateAutosave(entry.revision === undefined ? value : (value as unknown[])?.[entry.revision])
  }
  if (entry.revision === undefined) return validateAutosave(await idbGet(entry.key))
  // 历史条目临时读出后，复用资源解引用读取路径。
  const versions = await idbGet<unknown[]>(entry.key)
  const raw = versions?.[entry.revision] as ProjectData | undefined
  if (!raw) return null
  const db = await openDB()
  try {
    const pages = []
    for (const page of raw.pages) {
      const read = (image: string) => new Promise<string>((resolve, reject) => {
        if (!image.startsWith('asset:')) return resolve(image)
        const req = db.transaction('images', 'readonly').objectStore('images').get(image)
        req.onsuccess = () => resolve(req.result ?? '')
        req.onerror = () => reject(req.error)
      })
      pages.push({ ...page, image: await read(page.image), orig: page.orig ? { ...page.orig, image: await read(page.orig.image) } : undefined })
    }
    return validateAutosave({ ...raw, pages })
  } finally { db.close() }
}

const finite = z.number().finite()
const positive = finite.positive()
const point = { x: finite, y: finite }
const rect = { ...point, w: positive, h: positive }
const base = { id: z.string().min(1), locked: z.boolean().optional(), hidden: z.boolean().optional() }
const color = z.string().regex(/^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/)
const optionalSize = positive.optional()
const annotation = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.enum(['box', 'ellipse', 'highlight', 'redact']), ...rect, color }),
  z.object({ ...base, kind: z.literal('mosaic'), ...rect, tile: optionalSize }),
  z.object({ ...base, kind: z.literal('number'), ...point, r: optionalSize }),
  z.object({ ...base, kind: z.enum(['arrow', 'line']), x1: finite, y1: finite, x2: finite, y2: finite, color, width: optionalSize }),
  z.object({ ...base, kind: z.literal('freehand'), points: z.array(z.object(point)).min(1), color, width: optionalSize }),
  z.object({ ...base, kind: z.literal('text'), ...point, text: z.string(), color, size: optionalSize, background: z.boolean().optional() }),
  z.object({ ...base, kind: z.literal('callout'), ...rect, text: z.string(), color }),
  z.object({ ...base, kind: z.literal('magnifier'), ...rect, zoom: positive }),
])
const image = z.string().regex(/^data:image\/(png|jpeg|webp|gif);base64,/)
const annotations = z.array(annotation).refine(items => new Set(items.map(a => a.id)).size === items.length)
const snapshot = { image, width: positive, height: positive, annotations }
const page = z.object({ id: z.string().min(1), name: z.string().default('未命名步骤'), notes: z.string().default(''), notesRich: z.string().optional(), ...snapshot, orig: z.object(snapshot).optional() })
const align = z.enum(['left', 'center', 'right'])
const project = z.object({
  projectId: z.string().min(1).optional(),
  schemaVersion: z.literal(1).optional(),
  title: z.string().default('明白纸'),
  pages: z.array(page).refine(items => new Set(items.map(p => p.id)).size === items.length),
  exportStyle: z.object({
    title: positive.max(120).default(32), heading: positive.max(120).default(22), notes: positive.max(120).default(16),
    stepImageScale: finite.min(25).max(100).optional(), imageScale: finite.min(25).max(100).optional(),
    titleAlign: align.default('left'), headingAlign: align.default('left'), notesAlign: align.default('left'),
  }).transform(s => ({ ...s, stepImageScale: s.stepImageScale ?? s.imageScale ?? 100 })).default(DEFAULT_EXPORT_STYLE),
  exportFooter: z.object({ org: z.string(), version: z.string(), showDate: z.boolean() }).default(DEFAULT_EXPORT_FOOTER),
  savedAt: finite.optional(),
})
export type ProjectData = z.infer<typeof project>

/** 整份校验，损坏时拒绝覆盖现有项目，避免静默丢失标注。 */
export function validateAutosave(data: unknown) {
  const result = project.safeParse(data)
  return result.success ? result.data : null
}

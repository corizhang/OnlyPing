import { z } from 'zod'
import { DEFAULT_EXPORT_STYLE, DEFAULT_EXPORT_FOOTER } from '@/types'
/** 基于 IndexedDB 的本地存档：配额为磁盘级，可容纳含大量截图的项目 */

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
const assetKeys = new Map<string, string>()
const observedVersions = new Map<string, string>()
const fingerprint = (value: unknown) => JSON.stringify({ ...(value as object), savedAt: 0 })
export class ProjectConflictError extends Error {
  constructor() { super('此项目已在其他页面修改，请下载当前项目备份后重新打开本地项目') }
}

async function packImages(value: ProjectData) {
  const assets = new Map<string, string>()
  const pack = async (image: string) => {
    let key = assetKeys.get(image)
    if (!key) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(image))
      key = `asset:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`
      assetKeys.set(image, key)
      if (assetKeys.size > 4) assetKeys.delete(assetKeys.keys().next().value!)
    }
    assets.set(key, image)
    return key
  }
  const pages = []
  for (const page of value.pages) pages.push({ ...page, image: await pack(page.image), orig: page.orig ? { ...page.orig, image: await pack(page.orig.image) } : undefined })
  return { packed: { ...value, pages }, assets }
}

export function idbSet(value: unknown): Promise<void> {
  const valid = validateAutosave(value)
  if (!valid) return Promise.reject(new Error('项目包含无效数据，未覆盖存档'))
  const task = writeQueue.catch(() => undefined).then(() => writeProject(valid))
  writeQueue = task
  return task
}

async function writeProject(value: ProjectData): Promise<void> {
  const { packed, assets } = await packImages(value)
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, 'images'], 'readwrite')
    const store = tx.objectStore(STORE)
    const projectKey = `project:${value.projectId ?? 'legacy'}`
    const previous = store.get(projectKey)
    let conflict = false
    let committedVersion = ''
    const pruneUnusedImages = () => {
      const records = store.getAll()
      records.onsuccess = () => {
        const used = new Set<string>()
        for (const record of records.result.flat()) {
          for (const page of record?.pages ?? []) {
            used.add(page.image)
            if (page.orig) used.add(page.orig.image)
          }
        }
        const cursor = tx.objectStore('images').openCursor()
        cursor.onsuccess = () => {
          const row = cursor.result
          if (!row) return
          if (!used.has(String(row.key))) row.delete()
          row.continue()
        }
      }
    }
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
          pruneUnusedImages()
        }
      }
      for (const [key, image] of assets) tx.objectStore('images').put(image, key)
      store.put(unchanged ? old : packed, projectKey)
      store.put(unchanged ? old : packed, KEY)
      if (!old || unchanged) pruneUnusedImages()
    }
    tx.oncomplete = () => {
      observedVersions.set(projectKey, committedVersion)
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('IndexedDB 写入失败'))
    }
    tx.onabort = () => {
      db.close()
      reject(conflict ? new ProjectConflictError() : tx.error ?? new Error('IndexedDB 写入被中止'))
    }
  })
}

export async function idbGet<T>(key = KEY): Promise<T | null> {
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
const base = { id: z.string().min(1) }
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

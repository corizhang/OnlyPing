import { z } from 'zod'
import { DEFAULT_EXPORT_STYLE, DEFAULT_EXPORT_FOOTER } from '@/types'
/** 基于 IndexedDB 的本地存档：配额为磁盘级，可容纳含大量截图的项目 */

const DB_NAME = 'mingbai-tool'
const STORE = 'projects'
const KEY = 'autosave'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
  })
}

export async function idbSet(value: unknown): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const previous = store.get(KEY)
    previous.onsuccess = () => {
      if (validateAutosave(previous.result)) store.put(previous.result, 'backup')
      store.put(value, KEY)
    }
    tx.oncomplete = () => {
      db.close()
      resolve()
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('IndexedDB 写入失败'))
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error ?? new Error('IndexedDB 写入被中止'))
    }
  })
}

export async function idbGet<T>(key = KEY): Promise<T | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => {
      db.close()
      resolve((req.result as T) ?? null)
    }
    req.onerror = () => {
      db.close()
      reject(req.error ?? new Error('IndexedDB 读取失败'))
    }
  })
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
const page = z.object({ id: z.string().min(1), name: z.string().default('未命名步骤'), notes: z.string().default(''), ...snapshot, orig: z.object(snapshot).optional() })
const align = z.enum(['left', 'center', 'right'])
const project = z.object({
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

/** 整份校验，损坏时拒绝覆盖现有项目，避免静默丢失标注。 */
export function validateAutosave(data: unknown) {
  const result = project.safeParse(data)
  return result.success ? result.data : null
}

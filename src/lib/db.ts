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
    tx.objectStore(STORE).put(value, KEY)
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

export async function idbGet<T>(): Promise<T | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
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

/** 校验自动存档结构完整性，过滤损坏数据，返回可用的项目或 null */
export function validateAutosave(data: unknown): {
  title?: string
  pages: import('@/types').Page[]
  exportStyle?: import('@/types').ExportStyle
  exportFooter?: import('@/types').ExportFooter
  savedAt?: number
} | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (!Array.isArray(d.pages)) return null
  const pages = (d.pages as unknown[]).filter((p): p is import('@/types').Page => {
    if (!p || typeof p !== 'object') return false
    const pg = p as Record<string, unknown>
    return (
      typeof pg.id === 'string' &&
      typeof pg.image === 'string' &&
      typeof pg.width === 'number' &&
      typeof pg.height === 'number' &&
      Array.isArray(pg.annotations)
    )
  })
  if (!pages.length) return null
  // 标注结构清洗：丢弃字段缺失或类型未知的标注
  const clean = pages.map((p) => ({
    ...p,
    annotations: p.annotations.filter(
      (a) => a && typeof (a as { id?: unknown }).id === 'string' && ['box', 'mosaic', 'number', 'arrow', 'text'].includes((a as { kind?: string }).kind ?? '')
    ),
  }))
  return {
    title: typeof d.title === 'string' ? d.title : undefined,
    pages: clean,
    exportStyle: (d.exportStyle as import('@/types').ExportStyle) ?? undefined,
    exportFooter: (d.exportFooter as import('@/types').ExportFooter) ?? undefined,
    savedAt: typeof d.savedAt === 'number' ? d.savedAt : undefined,
  }
}

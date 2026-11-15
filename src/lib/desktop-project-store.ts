import type { ProjectData, LocalProjectEntry } from './db.ts'
import { ImageAssetCache } from './image-asset-cache.ts'

export interface LegacySnapshot { records: [string, unknown][]; assets: [string, string][] }
type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export function createDesktopProjectStore(invoke: Invoke, readLegacy: () => Promise<LegacySnapshot>, validate: (data: unknown) => ProjectData | null) {
  let initialized: Promise<void> | undefined
  let queue: Promise<unknown> = Promise.resolve()
  const observed = new Map<string, number>()
  const cache = new ImageAssetCache()
  const ready = () => initialized ??= (async () => {
    if (await invoke<boolean>('project_storage_ready')) return
    const snapshot = await readLegacy()
    const assets = new Map(snapshot.assets)
    const expand = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(expand)
      if (!value || typeof value !== 'object') return value
      const data = value as ProjectData
      const expanded = { ...data, pages: data.pages?.map(page => {
        const image = (value: string) => value.startsWith('asset:') ? assets.get(value) ?? '' : value
        return { ...page, image: image(page.image), orig: page.orig ? { ...page.orig, image: image(page.orig.image) } : undefined }
      }) }
      if (!validate(expanded)) throw new Error('旧存档损坏或图片缺失，迁移已停止；原 IndexedDB 数据保留')
      return expanded
    }
    for (const [key, value] of snapshot.records) {
      if (!key.startsWith('deleted:')) expand(value)
    }
    await invoke('project_storage_migrate', { snapshot })
  })().catch(error => { initialized = undefined; throw error })
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.catch(() => undefined).then(async () => { await ready(); return task() })
    queue = result
    return result
  }
  return {
    read: <T>(key = 'autosave') => enqueue(async () => {
      const result = await invoke<{ value: T | null; projectKey?: string; version?: number }>('project_storage_read', { key })
      if (result.projectKey && result.version !== undefined) observed.set(result.projectKey, result.version)
      return result.value
    }),
    list: () => enqueue(() => invoke<LocalProjectEntry[]>('project_storage_list')),
    save: (raw: unknown) => {
      const data = validate(raw)
      if (!data) return Promise.reject(new Error('项目包含无效数据，未覆盖存档'))
      const owners = (raw as ProjectData).pages
      return enqueue(async () => {
        const assets = new Map<string, string>()
        const pack = async (image: string, owner: object) => {
          const key = await cache.key(image, owner)
          assets.set(key, image)
          return key
        }
        const pages = []
        for (let i = 0; i < data.pages.length; i++) {
          const page = data.pages[i], owner = owners[i]
          pages.push({ ...page, image: await pack(page.image, owner), orig: page.orig ? { ...page.orig, image: await pack(page.orig.image, owner.orig ?? page.orig) } : undefined })
        }
        const missing = await invoke<string[]>('project_storage_missing_assets', { keys: [...assets.keys()] })
        const key = `project:${data.projectId ?? 'legacy'}`
        const version = await invoke<number>('project_storage_save', { data: { ...data, pages }, expectedVersion: observed.get(key) ?? null, assets: missing.map(key => [key, assets.get(key)]) })
        observed.set(key, version)
      })
    },
    remove: (key: string) => {
      if (!key.startsWith('project:') || key.length <= 8) return Promise.reject(new Error('无效项目'))
      return enqueue(async () => { await invoke('project_storage_delete', { key }); observed.delete(key) })
    },
  }
}

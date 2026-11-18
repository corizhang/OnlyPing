import type { ProjectData } from './db.ts'
import { safeFilename } from './native-files.ts'
import { projectContentHash } from './project-content.ts'

export interface ProjectFileSource { path: string; hash: string; file: File }
export interface PreviousProjectLocation { path: string; hash: string }
interface Host {
  open(): Promise<string | null>
  save(name: string): Promise<string | null>
  read(path: string): Promise<Uint8Array>
  version(path: string): Promise<string | null>
  write(path: string, contents: string, expectedHash: string | null): Promise<string>
  managedSave?(data: ProjectData, contents: string): Promise<{ path: string; hash: string }>
  remember?(data: ProjectData, path: string, hash: string): Promise<void>
  lookup?(id: string): Promise<{ path: string; hash: string } | null>
  snapshot?(id: string): Promise<{ path: string; hash: string; data: ProjectData }>
  relocate?(id: string, source: ProjectFileSource, previous: PreviousProjectLocation, data: ProjectData): Promise<void>
}
interface Binding { path: string; hash: string; saved: { title: string; pages: WeakRef<ProjectData['pages']>; style: string; footer: string } | null; contentHash?: Promise<string>; diskState?: 'external' | 'unavailable'; checked?: { signature: NonNullable<Binding['saved']>; dirty: boolean }; generation?: number }
const signature = (data: ProjectData): NonNullable<Binding['saved']> => ({ title: data.title, pages: new WeakRef(data.pages), style: JSON.stringify(data.exportStyle), footer: JSON.stringify(data.exportFooter) })
const matches = (saved: NonNullable<Binding['saved']>, data: ProjectData) => saved.pages.deref() === data.pages && saved.title === data.title && saved.style === JSON.stringify(data.exportStyle) && saved.footer === JSON.stringify(data.exportFooter)
export const projectFilename = (path: string) => path.split(/[\\/]/).pop() ?? path
const sameWindowsPath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

/** Persistent bindings are supplied by the native registry, never by untrusted UI storage. */
export function createProjectFileSession(host: Host) {
  const bindings = new Map<string, Binding>()
  let queue: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.catch(() => undefined).then(task)
    queue = result
    return result
  }
  return {
    binding: (id: string) => bindings.get(id),
    bind: (id: string, source: ProjectFileSource, saved: ProjectData) => { bindings.set(id, { path: source.path, hash: source.hash, saved: signature(saved), contentHash: projectContentHash(saved) }) },
    restore: (id: string) => enqueue(async () => {
      if (bindings.has(id) || !host.lookup) return
      const entry = await host.lookup(id)
      if (!entry) return
      const binding: Binding = { path: entry.path, hash: entry.hash, saved: null }
      bindings.set(id, binding)
      if (host.snapshot) {
        try { const snapshot = await host.snapshot(id); if (snapshot.hash !== entry.hash) binding.diskState = 'external'; else binding.contentHash = projectContentHash(snapshot.data) }
        catch { binding.diskState = 'unavailable' }
      }
    }),
    check: async (id: string, data: ProjectData) => {
      const binding = bindings.get(id)
      if (!binding || binding.diskState || !binding.contentHash) return
      const generation = (binding.generation ?? 0) + 1; binding.generation = generation
      const current = signature(data)
      const dirty = await projectContentHash(data) !== await binding.contentHash
      if (bindings.get(id) === binding && binding.generation === generation) binding.checked = { signature: current, dirty }
    },
    status: (id: string, data: ProjectData) => {
      const binding = bindings.get(id)
      if (!binding) return 'unbound'
      if (binding.diskState) return binding.diskState
      if (binding.saved && matches(binding.saved, data)) return 'saved'
      if (binding.checked && matches(binding.checked.signature, data)) return binding.checked.dirty ? 'dirty' : 'saved'
      return 'checking'
    },
    remember: async (data: ProjectData, source: ProjectFileSource) => { await host.remember?.(data, source.path, source.hash) },
    relocate: (id: string, source: ProjectFileSource, data: ProjectData, previous: PreviousProjectLocation) => enqueue(async () => {
      if (data.projectId !== id) throw new Error('所选文件不是同一个项目，未修改原关联')
      if (!host.relocate) throw new Error('当前环境不支持重新定位项目文件')
      await host.relocate(id, source, previous, data)
      bindings.set(id, { path: source.path, hash: source.hash, saved: signature(data), contentHash: projectContentHash(data) })
    }),
    refreshDisk: (id: string) => enqueue(async () => {
      const binding = bindings.get(id)
      if (!binding) return
      try { const hash = await host.version(binding.path); binding.diskState = hash === null ? 'unavailable' : hash !== binding.hash ? 'external' : undefined }
      catch { binding.diskState = 'unavailable' }
    }),
    dirty: (id: string, data: ProjectData) => {
      const binding = bindings.get(id)
      if (!binding) return false
      if (binding.diskState) return true
      if (binding.checked && matches(binding.checked.signature, data)) return binding.checked.dirty
      const saved = binding.saved
      if (!saved) return true
      // Conservative identity comparison avoids serializing large screenshot strings per edit.
      return !matches(saved, data)
    },
    open: () => enqueue(async (): Promise<ProjectFileSource | null> => {
      const path = await host.open()
      if (path === null) return null
      const bytes = await host.read(path)
      const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)
      const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
      return { path, hash, file: new File([new Uint8Array(bytes).buffer], projectFilename(path), { type: 'application/json' }) }
    }),
    save: (data: ProjectData, saveAs = false) => enqueue(async () => {
      const id = data.projectId
      if (!id) throw Error('当前项目缺少标识，未写入文件')
      const binding = bindings.get(id)
      if (!saveAs && !binding && host.managedSave) {
        const contentHash = projectContentHash(data)
        const result = await host.managedSave(data, JSON.stringify({ ...data, savedAt: undefined }, null, 2))
        bindings.set(id, { path: result.path, hash: result.hash, saved: signature(data), contentHash })
        return result.path
      }
      const path = !saveAs && binding ? binding.path : await host.save(safeFilename(`${data.title || '明白纸'}${saveAs ? ' - 副本' : ''}.json`))
      if (path === null) return null
      const contentHash = projectContentHash(data)
      const expectedHash = binding && sameWindowsPath(binding.path, path) ? binding.hash : await host.version(path)
      const hash = await host.write(path, JSON.stringify({ ...data, savedAt: undefined }, null, 2), expectedHash)
      await host.remember?.(data, path, hash)
      bindings.set(id, { path, hash, saved: signature(data), contentHash })
      return path
    }),
  }
}

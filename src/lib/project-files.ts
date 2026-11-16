import type { ProjectData } from './db.ts'
import { safeFilename } from './native-files.ts'

export interface ProjectFileSource { path: string; hash: string; file: File }
interface Host {
  open(): Promise<string | null>
  save(name: string): Promise<string | null>
  read(path: string): Promise<Uint8Array>
  version(path: string): Promise<string | null>
  write(path: string, contents: string, expectedHash: string | null): Promise<string>
}
interface Binding { path: string; hash: string; saved: { title: string; pages: WeakRef<ProjectData['pages']>; style: string; footer: string } }
const signature = (data: ProjectData): Binding['saved'] => ({ title: data.title, pages: new WeakRef(data.pages), style: JSON.stringify(data.exportStyle), footer: JSON.stringify(data.exportFooter) })
export const projectFilename = (path: string) => path.split(/[\\/]/).pop() ?? path
const sameWindowsPath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

/** Bindings are session-only: disk authorization is never silently restored after restart. */
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
    bind: (id: string, source: ProjectFileSource, saved: ProjectData) => { bindings.set(id, { path: source.path, hash: source.hash, saved: signature(saved) }) },
    dirty: (id: string, data: ProjectData) => {
      const binding = bindings.get(id)
      if (!binding) return false
      const saved = binding.saved
      // Conservative identity comparison avoids serializing large screenshot strings per edit.
      return saved.pages.deref() !== data.pages || saved.title !== data.title || saved.style !== JSON.stringify(data.exportStyle) || saved.footer !== JSON.stringify(data.exportFooter)
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
      const path = !saveAs && binding ? binding.path : await host.save(safeFilename(`${data.title || '明白纸'}${saveAs ? ' - 副本' : ''}.json`))
      if (path === null) return null
      const expectedHash = binding && sameWindowsPath(binding.path, path) ? binding.hash : await host.version(path)
      const hash = await host.write(path, JSON.stringify({ ...data, savedAt: undefined }, null, 2), expectedHash)
      bindings.set(id, { path, hash, saved: signature(data) })
      return path
    }),
  }
}

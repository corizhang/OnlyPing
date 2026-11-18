import { isTauri } from '@tauri-apps/api/core'
import { createNativeFiles } from './native-files.ts'
import { createProjectFileSession } from './project-files.ts'
import type { ImageFolderHost } from './image-export-folder.ts'
import { projectThumbnail, workspaceInvoke, type WorkspaceEntry } from './workspace.ts'

export function nativeImageFolderHost(): ImageFolderHost {
  const call = async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
    try { return await (await import('@tauri-apps/api/core')).invoke<T>(command, args) }
    catch (error) { throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : '文件夹导出失败') }
  }
  return {
    begin: async names => {
      if (!isDesktop()) throw new Error('导出到文件夹仅支持桌面端，请使用 PNG/ZIP 下载')
      const parent = await (await import('@tauri-apps/plugin-dialog')).open({ title: '选择标注图片导出位置（将新建子目录）', directory: true, multiple: false, recursive: false })
      if (parent === null) return null
      if (typeof parent !== 'string') throw new Error('请选择一个文件夹')
      return call<{ id: string; path: string }>('image_export_begin', { parent, names })
    },
    write: async (id, index, bytes) => {
      try { await (await import('@tauri-apps/api/core')).invoke('image_export_write', bytes, { headers: { 'x-onlyping-session': id, 'x-onlyping-index': String(index) } }) }
      catch (error) { throw new Error(typeof error === 'string' ? error : error instanceof Error ? error.message : '图片写入失败') }
    },
    end: id => call<void>('image_export_end', { id }),
  }
}

export const isDesktop = () => typeof window !== 'undefined' && isTauri()
let native: Promise<ReturnType<typeof createNativeFiles>> | null = null
let active = 0
export const hasActiveFileOperation = () => active > 0
async function projectFileInvoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try { return await (await import('@tauri-apps/api/core')).invoke<T>(command, args) }
  catch (error) { throw new Error((error as { message?: string })?.message ?? '项目文件操作失败，请保留当前内容并另存为') }
}
export function createNativeProjectSession() {
  return createProjectFileSession({
    open: async () => {
      const path = await (await import('@tauri-apps/plugin-dialog')).open({ title: '打开 OnlyPing 项目文件', multiple: false, filters: [{ name: 'OnlyPing 项目', extensions: ['json'] }] })
      if (Array.isArray(path)) throw new Error('请选择单个项目文件')
      return path
    },
    save: async defaultPath => (await import('@tauri-apps/plugin-dialog')).save({ title: '保存 OnlyPing 项目文件', defaultPath, filters: [{ name: 'OnlyPing 项目', extensions: ['json'] }] }),
    read: async path => (await import('@tauri-apps/plugin-fs')).readFile(path),
    version: path => projectFileInvoke<string | null>('project_file_version', { path }),
    write: (path, contents, expectedHash) => projectFileInvoke<string>('project_file_write', { path, contents, expectedHash }),
    managedSave: async (data, contents) => workspaceInvoke<WorkspaceEntry>('workspace_save', { contents, thumbnail: await projectThumbnail(data) }),
    remember: async (data, path, hash) => { await workspaceInvoke('workspace_remember', { path, hash, thumbnail: await projectThumbnail(data) }) },
    lookup: id => workspaceInvoke<WorkspaceEntry | null>('workspace_lookup', { id }),
    relocate: async (id, source, previous, data) => { await workspaceInvoke('workspace_relocate', { id, path: source.path, hash: source.hash, previousPath: previous.path, previousHash: previous.hash, thumbnail: await projectThumbnail(data) }) },
    snapshot: async id => {
      const snapshot = await workspaceInvoke<{ entry: WorkspaceEntry; contents: string }>('workspace_snapshot', { id })
      const { validateAutosave } = await import('./db.ts')
      const data = validateAutosave(JSON.parse(snapshot.contents.replace(/^\uFEFF/, '')))
      if (!data || data.projectId !== id) throw new Error('项目文件内容无效，未确认保存状态')
      return { path: snapshot.entry.path, hash: snapshot.entry.hash, data }
    },
  })
}
/** Include settings writes in the desktop close guard. */
export async function withNativeOperation<T>(task: () => Promise<T>): Promise<T> {
  active++
  try { return await task() } finally { active-- }
}
async function nativeFiles() {
  if (!native) native = Promise.all([import('@tauri-apps/plugin-dialog'), import('@tauri-apps/plugin-fs')])
    .then(([dialog, fs]) => createNativeFiles({ save: dialog.save, open: dialog.open, readFile: fs.readFile, writeFile: fs.writeFile }))
    .catch(error => { native = null; throw error })
  return native
}

export async function saveFile(blob: Blob, filename: string, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted()
  if (isDesktop()) {
    active++
    try { return await (await nativeFiles()).save(blob, filename, signal) } finally { active-- }
  }
  const anchor = document.createElement('a'), url = URL.createObjectURL(blob)
  anchor.href = url; anchor.download = filename
  try { anchor.click() } finally { setTimeout(() => URL.revokeObjectURL(url), 5000) }
  return null
}

export async function registerImageExportFile(path: string): Promise<{ id: string; path: string }> {
  return (await import('@tauri-apps/api/core')).invoke('image_export_file_location', { path })
}
export async function openImageExportLocation(id: string): Promise<void> {
  try { await (await import('@tauri-apps/api/core')).invoke('image_export_open_location', { id }) }
  catch (error) { throw new Error(typeof error === 'string' ? error : '无法打开导出目录，请根据显示的路径手动查看') }
}

export async function openProjectFile(): Promise<File | null> {
  if (!isDesktop()) return null
  active++
  try { return await (await nativeFiles()).openProject() } finally { active-- }
}

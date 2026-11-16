import { isTauri } from '@tauri-apps/api/core'
import { createNativeFiles } from './native-files.ts'
import { createProjectFileSession } from './project-files.ts'

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

export async function saveFile(blob: Blob, filename: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  if (isDesktop()) {
    active++
    try { await (await nativeFiles()).save(blob, filename, signal) } finally { active-- }
    return
  }
  const anchor = document.createElement('a'), url = URL.createObjectURL(blob)
  anchor.href = url; anchor.download = filename
  try { anchor.click() } finally { setTimeout(() => URL.revokeObjectURL(url), 5000) }
}

export async function openProjectFile(): Promise<File | null> {
  if (!isDesktop()) return null
  active++
  try { return await (await nativeFiles()).openProject() } finally { active-- }
}

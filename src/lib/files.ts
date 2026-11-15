import { isTauri } from '@tauri-apps/api/core'
import { createNativeFiles } from './native-files.ts'

export const isDesktop = () => typeof window !== 'undefined' && isTauri()
let native: Promise<ReturnType<typeof createNativeFiles>> | null = null
let active = 0
export const hasActiveFileOperation = () => active > 0
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

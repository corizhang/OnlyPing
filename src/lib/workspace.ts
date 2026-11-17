import type { ProjectData } from './db.ts'
export interface WorkspaceEntry { id: string; path: string; hash: string; title: string; pages: number; savedAt: number; accessedAt: number; thumbnail: string | null; available: boolean }
export interface WorkspaceInfo { directory: string; projects: WorkspaceEntry[] }
export async function workspaceInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  try { return await (await import('@tauri-apps/api/core')).invoke<T>(command, args) }
  catch (error) { throw new Error(typeof error === 'string' ? error : (error as { message?: string })?.message ?? '项目目录操作失败，请保留工作区并重试') }
}
export async function projectThumbnail(data: ProjectData): Promise<string | null> {
  const page = data.pages[0]
  if (!page) return null
  try {
    const scale = Math.min(180 / page.width, 120 / page.height, 1)
    const { renderAnnotatedImage } = await import('./export-annotated-images.ts')
    const blob = await renderAnnotatedImage({ ...page, annotations: page.annotations.map(annotation => annotation.kind === 'mosaic' || annotation.kind === 'redact' ? { ...annotation, hidden: false } : annotation) }, 0, {}, { width: Math.max(1, Math.round(page.width * scale)), height: Math.max(1, Math.round(page.height * scale)) }, { format: 'jpeg', quality: 65 })
    return await new Promise<string | null>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(typeof reader.result === 'string' && reader.result.length <= 100_000 ? reader.result : null); reader.onerror = () => resolve(null); reader.readAsDataURL(blob) })
  } catch { return null }
}

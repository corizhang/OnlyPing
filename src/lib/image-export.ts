import { computeNumberStarts, type Page } from '../types/index.ts'
import { safeFilename } from './native-files.ts'
import { checkTask, isTaskCancelled, taskCheckpoint, type RenderTask } from './render-task.ts'

export type ImageExportSelection = { scope: 'current'; currentId: string | null } | { scope: 'selected'; ids: string[] } | { scope: 'all' }
export interface ImageExportJob { page: Page; index: number; filename: string; numberStart: number }
export const IMAGE_EXPORT_MAX_BYTES = 200 * 1024 * 1024
export const IMAGE_EXPORT_MAX_PAGES = 1000
const cleanName = (value: string, fallback: string) => safeFilename(Array.from(value.trim() || fallback).slice(0, 80).join(''))

export function planImageExport(pages: Page[], selection: ImageExportSelection): ImageExportJob[] {
  const known = new Set(pages.map(page => page.id))
  if (known.size !== pages.length) throw new Error('项目存在重复图片标识，请先备份并检查项目')
  const ids = selection.scope === 'all' ? known : new Set(selection.scope === 'current' ? selection.currentId ? [selection.currentId] : [] : selection.ids)
  if (!ids.size) throw new Error('请至少选择一张图片')
  if ([...ids].some(id => !known.has(id))) throw new Error('部分图片已被删除或切换，请重新选择')
  if (ids.size > IMAGE_EXPORT_MAX_PAGES) throw new Error(`每批最多导出 ${IMAGE_EXPORT_MAX_PAGES} 张图片，请分批选择`)
  // Compute before filtering so selected images retain the numbers visible on the canvas.
  const starts = computeNumberStarts(pages)
  const digits = Math.max(3, String(pages.length).length)
  return pages.flatMap((page, index) => {
    if (!ids.has(page.id)) return []
    if (![page.width, page.height].every(value => Number.isFinite(value) && value > 0) || page.width * page.height > 40_000_000) throw new Error(`第 ${index + 1} 张图片尺寸无效或超过 4000 万像素，请缩小后导出`)
    const name = cleanName(page.name.replace(/\.(png|jpe?g|webp|gif)$/i, ''), `步骤${index + 1}`)
    return [{ page: { ...page, annotations: structuredClone(page.annotations), notes: '', notesRich: undefined, orig: undefined }, index, filename: `${String(index + 1).padStart(digits, '0')}-${name}.png`, numberStart: starts.get(page.id) ?? 0 }]
  })
}

export function imageExportWarnings(jobs: ImageExportJob[]): string[] {
  return jobs.filter(job => job.page.annotations.some(annotation => annotation.hidden && (annotation.kind === 'mosaic' || annotation.kind === 'redact')))
    .map(job => `第 ${job.index + 1} 张「${job.page.name || '未命名图片'}」有隐藏的打码或遮挡，导出不包含这些保护`)
}

/** No output is returned until every selected image succeeds. PNGs stay compressed (ZIP STORE). */
export async function buildAnnotatedImages(title: string, jobs: ImageExportJob[], render: (page: Page, numberStart: number, task: RenderTask) => Promise<Blob>, task: RenderTask = {}, maxBytes = IMAGE_EXPORT_MAX_BYTES) {
  checkTask(task)
  if (!jobs.length) throw new Error('没有可导出的图片')
  const zip = jobs.length > 1 ? new (await import('jszip')).default() : null
  checkTask(task)
  let totalBytes = 0
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]
    await taskCheckpoint(task, '正在导出标注图片', i, jobs.length)
    let blob: Blob
    try {
      blob = await render(job.page, job.numberStart, task)
      checkTask(task)
      if (!blob.size) throw new Error('PNG 编码结果为空')
    } catch (error) {
      if (isTaskCancelled(error)) throw error
      checkTask(task)
      throw new Error(`第 ${job.index + 1} 张「${job.page.name || '未命名图片'}」导出失败：${error instanceof Error ? error.message : '无法读取或编码图片'}`)
    }
    totalBytes += blob.size
    if (totalBytes > maxBytes) throw new Error(`本批 PNG 合计超过 ${Math.round(maxBytes / 1048576)} MiB，请分批选择后重试；未生成不完整导出包`)
    if (!zip) {
      await taskCheckpoint(task, '标注图片已生成', 1, 1)
      return { blob, filename: job.filename }
    }
    const bytes = await blob.arrayBuffer()
    checkTask(task)
    zip.file(job.filename, bytes)
    await taskCheckpoint(task, '正在导出标注图片', i + 1, jobs.length)
  }
  if (!zip) throw new Error('图片打包状态无效')
  await taskCheckpoint(task, '正在打包标注图片', 0, 100)
  const bytes = await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE', streamFiles: true }, progress => {
    checkTask(task)
    task.onProgress?.({ phase: '正在打包标注图片', completed: Math.round(progress.percent), total: 100 })
  })
  checkTask(task)
  return { blob: new Blob([bytes], { type: 'application/zip' }), filename: `${cleanName(title, '明白纸')}-标注图片.zip` }
}

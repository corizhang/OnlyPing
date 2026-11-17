import { computeNumberStarts, type Page } from '../types/index.ts'
import { safeFilename } from './native-files.ts'
import { checkTask, isTaskCancelled, taskCheckpoint, type RenderTask } from './render-task.ts'
import { ImageExportImageFailure } from './image-export-result.ts'

export type ImageExportSelection = { scope: 'current'; currentId: string | null } | { scope: 'selected'; ids: string[] } | { scope: 'all' }
export type ImageExportSize = { mode: 'original' } | { mode: 'percent'; value: number } | { mode: 'maxWidth'; value: number }
export interface ImageExportEncoding { format: 'png' | 'jpeg'; quality: number }
export interface ImageExportOptions { size: ImageExportSize; numbering: 'project' | 'per-image'; destination?: 'download' | 'folder'; format?: 'png' | 'jpeg'; quality?: number }
export interface ImageExportDimensions { width: number; height: number }
export interface ImageExportJob { page: Page; index: number; filename: string; numberStart: number; dimensions: ImageExportDimensions; encoding: ImageExportEncoding }
export const DEFAULT_IMAGE_EXPORT_OPTIONS: ImageExportOptions = { size: { mode: 'original' }, numbering: 'project' }

export function imageExportDimensions(width: number, height: number, size: ImageExportSize): ImageExportDimensions {
  if (![width, height].every(value => Number.isInteger(value) && value > 0) || width * height > 40_000_000) throw new Error('图片尺寸无效或超过 4000 万像素')
  let scale = 1
  if (size.mode === 'percent') {
    if (!Number.isFinite(size.value) || size.value < 1 || size.value > 100) throw new Error('缩放比例需为 1–100%')
    scale = size.value / 100
  } else if (size.mode === 'maxWidth') {
    if (!Number.isInteger(size.value) || size.value < 1 || size.value > 32768) throw new Error('最大宽度需为 1–32768 的整数')
    scale = Math.min(1, size.value / width)
  } else if (size.mode !== 'original') throw new Error('未知的图片尺寸设置')
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
export const IMAGE_EXPORT_MAX_BYTES = 200 * 1024 * 1024
export const IMAGE_EXPORT_MAX_PAGES = 1000
const cleanName = (value: string, fallback: string) => safeFilename(Array.from(value.trim() || fallback).slice(0, 80).join(''))

export function planImageExport(pages: Page[], selection: ImageExportSelection, options: ImageExportOptions = DEFAULT_IMAGE_EXPORT_OPTIONS): ImageExportJob[] {
  const format = options.format ?? 'png', quality = options.quality ?? 90
  if (format !== 'png' && format !== 'jpeg') throw new Error('不支持的图片格式')
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error('JPEG 质量需为 1–100 的整数')
  if (!['project', 'per-image'].includes(options.numbering)) throw new Error('未知的序号方式')
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
    const dimensions = imageExportDimensions(page.width, page.height, options.size)
    const name = cleanName(page.name.replace(/\.(png|jpe?g|webp|gif)$/i, ''), `步骤${index + 1}`)
    return [{ page: { ...page, annotations: structuredClone(page.annotations), notes: '', notesRich: undefined, orig: undefined }, index, filename: `${String(index + 1).padStart(digits, '0')}-${name}.${format === 'jpeg' ? 'jpg' : 'png'}`, numberStart: options.numbering === 'per-image' ? 0 : starts.get(page.id) ?? 0, dimensions, encoding: { format, quality } }]
  })
}

export function imageExportWarnings(jobs: ImageExportJob[]): string[] {
  return jobs.filter(job => job.page.annotations.some(annotation => annotation.hidden && (annotation.kind === 'mosaic' || annotation.kind === 'redact')))
    .map(job => `第 ${job.index + 1} 张「${job.page.name || '未命名图片'}」有隐藏的打码或遮挡，导出不包含这些保护`)
}

/** No output is returned until every selected image succeeds. Encoded images use ZIP STORE. */
export async function buildAnnotatedImages(title: string, jobs: ImageExportJob[], render: (page: Page, numberStart: number, task: RenderTask, dimensions: ImageExportDimensions, encoding: ImageExportEncoding) => Promise<Blob>, task: RenderTask = {}, maxBytes = IMAGE_EXPORT_MAX_BYTES) {
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
      blob = await render(job.page, job.numberStart, task, job.dimensions, job.encoding)
      checkTask(task)
      if (!blob.size) throw new Error('图片编码结果为空')
    } catch (error) {
      if (isTaskCancelled(error)) throw error
      checkTask(task)
      throw new ImageExportImageFailure(`第 ${job.index + 1} 张「${job.page.name || '未命名图片'}」导出失败：${error instanceof Error ? error.message : '无法读取或编码图片'}`, { index: job.index, name: job.page.name })
    }
    totalBytes += blob.size
    if (totalBytes > maxBytes) throw new Error(`本批图片合计超过 ${Math.round(maxBytes / 1048576)} MiB，请分批选择后重试；未生成不完整导出包`)
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

import { buildAnnotatedImages, imageExportDimensions, type ImageExportDimensions, type ImageExportEncoding, type ImageExportJob } from './image-export.ts'
import { renderPageToCanvas } from './render.ts'
import type { Page } from '@/types'
import { canvasBlob, checkTask, releaseCanvas, RenderQueue, taskCheckpoint, type RenderTask } from './render-task.ts'
import { encodeImageExportPreview } from './image-export-preview.ts'
import { nativeImageFolderHost, registerImageExportFile, saveFile, withNativeOperation } from './files.ts'
import type { ImageExportReport } from './image-export-result.ts'
import { writeImagesToFolder } from './image-export-folder.ts'

const imageRenderQueue = new RenderQueue()
async function withAnnotatedCanvas<T>(page: Page, numberStart: number, task: RenderTask, dimensions: ImageExportDimensions, flatten: boolean, encode: (canvas: HTMLCanvasElement) => Promise<T>) {
  checkTask(task)
  imageExportDimensions(dimensions.width, dimensions.height, { mode: 'original' })
  if (dimensions.width > page.width || dimensions.height > page.height) throw new Error('图片导出不支持放大')
  const canvas = await renderPageToCanvas(page, numberStart)
  let resized: HTMLCanvasElement | undefined
  try {
    checkTask(task)
    if (!flatten && canvas.width === dimensions.width && canvas.height === dimensions.height) return await encode(canvas)
    resized = document.createElement('canvas')
    resized.width = dimensions.width; resized.height = dimensions.height
    const context = resized.getContext('2d')
    if (!context) throw new Error('无法创建图片缩放画布')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    if (flatten) { context.fillStyle = '#ffffff'; context.fillRect(0, 0, resized.width, resized.height) }
    context.drawImage(canvas, 0, 0, dimensions.width, dimensions.height)
    return await encode(resized)
  } finally { releaseCanvas(canvas); if (resized) releaseCanvas(resized) }
}

export async function renderAnnotatedImage(page: Page, numberStart: number, task: RenderTask = {}, dimensions: ImageExportDimensions = { width: page.width, height: page.height }, encoding: ImageExportEncoding = { format: 'png', quality: 90 }) {
  return imageRenderQueue.run(task, () => withAnnotatedCanvas(page, numberStart, task, dimensions, encoding.format === 'jpeg', canvas => canvasBlob(canvas, task, encoding.format === 'jpeg' ? 'image/jpeg' : 'image/png', encoding.format === 'jpeg' ? encoding.quality / 100 : undefined)))
}
export async function renderAnnotatedImagePreview(job: ImageExportJob, task: RenderTask = {}) {
  if (job.encoding.format !== 'jpeg') throw new Error('压缩预览仅适用于 JPEG')
  return imageRenderQueue.run(task, () => withAnnotatedCanvas(job.page, job.numberStart, task, job.dimensions, true, canvas => encodeImageExportPreview(canvas, job.encoding.quality, task)))
}

export async function exportAnnotatedImages(title: string, jobs: ImageExportJob[], task: RenderTask = {}, destination: 'download' | 'folder' = 'download') {
  if (destination === 'folder') return withNativeOperation(() => writeImagesToFolder(jobs, renderAnnotatedImage, nativeImageFolderHost(), task))
  const output = await buildAnnotatedImages(title, jobs, renderAnnotatedImage, task)
  await taskCheckpoint(task, '请选择图片导出的保存位置', 1, 1)
  const path = await saveFile(output.blob, output.filename, task.signal)
  let location: { id: string; path: string } | undefined
  if (path) { try { location = await registerImageExportFile(path) } catch { /* Saving succeeded; a reveal failure must not turn it into a failed export. */ } }
  return { directory: location?.path, report: { status: 'success', total: jobs.length, completed: jobs.length, delivery: path ? 'native-file' : 'download', filename: output.filename, path: path ?? undefined, directory: location?.path, locationId: location?.id, pending: [] } satisfies ImageExportReport }
}

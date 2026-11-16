import { buildAnnotatedImages, type ImageExportJob } from './image-export.ts'
import { renderPageToCanvas } from './render.ts'
import type { Page } from '@/types'
import { canvasBlob, checkTask, releaseCanvas, taskCheckpoint, type RenderTask } from './render-task.ts'
import { saveFile } from './files.ts'

export async function renderAnnotatedImage(page: Page, numberStart: number, task: RenderTask = {}) {
  checkTask(task)
  const canvas = await renderPageToCanvas(page, numberStart)
  try { return await canvasBlob(canvas, task) }
  finally { releaseCanvas(canvas) }
}

export async function exportAnnotatedImages(title: string, jobs: ImageExportJob[], task: RenderTask = {}) {
  const output = await buildAnnotatedImages(title, jobs, renderAnnotatedImage, task)
  await taskCheckpoint(task, '请选择图片导出的保存位置', 1, 1)
  await saveFile(output.blob, output.filename, task.signal)
}

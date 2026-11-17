import { canvasBlob, checkTask, type RenderTask } from './render-task.ts'

/** Compare the same composed pixels; the reference is PNG, not the original source file. */
export async function encodeImageExportPreview(canvas: HTMLCanvasElement, quality: number, task: RenderTask = {}) {
  checkTask(task)
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new Error('JPEG 质量需为 1–100 的整数')
  const width = canvas.width, height = canvas.height
  const reference = await canvasBlob(canvas, task)
  const output = await canvasBlob(canvas, task, 'image/jpeg', quality / 100)
  checkTask(task)
  if (!reference.size || !output.size) throw new Error('预览编码结果为空')
  return { reference, output, width, height }
}

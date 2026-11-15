import type { ExportFooter, ExportStyle, Page } from '@/types'
import { DEFAULT_EXPORT_FOOTER, DEFAULT_EXPORT_STYLE } from '@/types'
import { checkTask, taskCheckpoint, canvasBlob, type RenderTask } from './render-task'
import { renderDocument } from './export-layout'
import { packageLongImages } from './export-files'
import { download } from './export-common'

export async function exportPdf(title: string, pages: Page[], style: ExportStyle = DEFAULT_EXPORT_STYLE, footer: ExportFooter = DEFAULT_EXPORT_FOOTER, imageScale = 1, task: RenderTask = {}) {
  checkTask(task)
  const { jsPDF } = await import('jspdf')
  checkTask(task)
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  await renderDocument(title, pages, style, footer, 'pdf', imageScale, { ...task, onCanvas: async (canvas, i) => {
    await taskCheckpoint(task, '正在编码 PDF 页', i, i + 1)
    if (i) pdf.addPage()
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight())
  } })
  await taskCheckpoint(task, '正在打包 PDF', pages.length, pages.length)
  await download(pdf.output('blob'), `${title || '明白纸'}.pdf`, task.signal)
}

export async function exportLongImage(title: string, pages: Page[], style: ExportStyle = DEFAULT_EXPORT_STYLE, footer: ExportFooter = DEFAULT_EXPORT_FOOTER, imageScale = 1, task: RenderTask = {}) {
  const blobs: Blob[] = []
  await renderDocument(title, pages, style, footer, 'long', imageScale, { ...task, onCanvas: async (canvas, index) => {
    await taskCheckpoint(task, '正在编码长图', index, index + 1)
    blobs.push(await canvasBlob(canvas, task))
  } })
  const file = await packageLongImages(title, blobs, task)
  checkTask(task)
  await download(file.blob, file.filename, task.signal)
}

import { RenderQueue, checkTask, taskCheckpoint, releaseCanvas, canvasBlob, type RenderTask } from './render-task'
import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { ExportFooter, ExportStyle, Page } from '@/types'
import { computeNumberStarts, DEFAULT_EXPORT_FOOTER, DEFAULT_EXPORT_STYLE } from '@/types'
import { dataUrlToBase64, renderPageToCanvas } from './render'
import { notesColor, notesFontSize, notesLineHeight, safeNotesHtml } from './notes'

function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

const documentQueue = new RenderQueue()

const FONT = '"PingFang SC", "Microsoft YaHei", sans-serif'
const DOC_MAX_WIDTH = 560 // docx 图片最大宽度（px 计）

/** 组装页脚文本：编制单位 + 日期 + 版本 */
export function footerText(footer: ExportFooter): string {
  const parts: string[] = []
  if (footer.org) parts.push(footer.org)
  if (footer.showDate) parts.push(`编制日期：${new Date().toLocaleDateString('zh-CN')}`)
  if (footer.version) parts.push(`版本：${footer.version}`)
  return parts.join('　')
}

const wordAlignment = (alignment: ExportStyle['titleAlign']) => ({
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
})[alignment]

/** Convert the supported notes markup to editable Word paragraphs and text runs. */
function wordNotes(page: Page, style: ExportStyle): Paragraph[] {
  const container = document.createElement('div')
  container.innerHTML = safeNotesHtml(page)
  type Marks = { bold: boolean; italics: boolean; underline: boolean; strike: boolean; color?: string; background?: string; size?: number }
  const defaultMarks: Marks = { bold: false, italics: false, underline: false, strike: false }
  const makeRun = (text: string, marks: Marks, lineBreak = false) => new TextRun({
    text, break: lineBreak ? 1 : undefined,
    size: Math.round((marks.size ?? style.notes) * 2),
    bold: marks.bold, italics: marks.italics, strike: marks.strike,
    underline: marks.underline ? {} : undefined,
    color: marks.color?.slice(1),
    shading: marks.background ? { fill: marks.background.slice(1) } : undefined,
  })
  const runs = (node: Node, marks: Marks = defaultMarks): TextRun[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ? [makeRun(node.textContent, marks)] : []
    }
    if (!(node instanceof HTMLElement)) return []
    if (node.tagName === 'BR') return [makeRun('', marks, true)]
    const next: Marks = {
      bold: marks.bold || node.tagName === 'STRONG',
      italics: marks.italics || node.tagName === 'EM',
      underline: marks.underline || node.tagName === 'U',
      strike: marks.strike || node.tagName === 'S',
      color: notesColor(node.style.color)?.toUpperCase() ?? marks.color,
      background: notesColor(node.style.backgroundColor)?.toUpperCase() ?? marks.background,
      size: notesFontSize(node.style.fontSize) ?? marks.size,
    }
    return Array.from(node.childNodes).flatMap(child => runs(child, next))
  }
  const paragraphOptions = (block: HTMLElement) => ({
    alignment: wordAlignment((['left', 'center', 'right'].includes(block.style.textAlign)
      ? block.style.textAlign : style.notesAlign ?? 'left') as ExportStyle['notesAlign']),
    spacing: { line: Math.round(240 * (notesLineHeight(block.style.lineHeight) ?? 1.7)) },
  })
  const paragraphs: Paragraph[] = []
  for (const block of Array.from(container.childNodes)) {
    if (!(block instanceof HTMLElement)) continue
    if (block.tagName === 'UL' || block.tagName === 'OL') {
      Array.from(block.children).forEach((item, index) => {
        const paragraph = item.querySelector('p') ?? item as HTMLElement
        paragraphs.push(new Paragraph({
          ...paragraphOptions(paragraph),
          indent: { left: 320 },
          children: [makeRun(block.tagName === 'UL' ? '•  ' : `${index + 1}.  `, defaultMarks), ...runs(item)],
        }))
      })
    } else {
      paragraphs.push(new Paragraph({ ...paragraphOptions(block), children: runs(block) }))
    }
  }
  return paragraphs
}

/** 导出 Word：标题 + 每页「步骤 N 说明 + 标注后截图 + 文字」 */
export async function exportDocx(title: string, pages: Page[], style: ExportStyle = DEFAULT_EXPORT_STYLE, footer: ExportFooter = DEFAULT_EXPORT_FOOTER, imageScale = 1, task: RenderTask = {}) {
  checkTask(task)
  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: wordAlignment(style.titleAlign ?? 'left'),
      children: [new TextRun({ text: title || '明白纸', bold: true, size: Math.round(style.title * 2) })],
    }),
  ]
  const starts = computeNumberStarts(pages)
  for (let i = 0; i < pages.length; i++) {
    await taskCheckpoint(task, '正在生成 Word 步骤', i, pages.length)
    const page = pages[i]
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        alignment: wordAlignment(style.headingAlign ?? 'left'),
        spacing: { before: 320 },
        children: [new TextRun({ text: `步骤 ${i + 1}`, bold: true, size: Math.round(style.heading * 2) })],
      })
    )
    if (page.notes) {
      children.push(
        ...wordNotes(page, style),
        new Paragraph({ children: [new TextRun('')] })
      )
    }
    const canvas = await renderPageToCanvas(page, starts.get(page.id) ?? 0)
    let dataUrl: string
    try { checkTask(task); dataUrl = canvas.toDataURL('image/png') } finally { releaseCanvas(canvas) }
    const ratio = Math.min(1, DOC_MAX_WIDTH / page.width)
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            type: 'png',
            data: dataUrlToBase64(dataUrl),
            transformation: {
              width: Math.round(page.width * ratio * imageScale),
              height: Math.round(page.height * ratio * imageScale),
            },
          }),
        ],
      })
    )
  }
  const ft = footerText(footer)
  if (ft) {
    children.push(
      new Paragraph({
        spacing: { before: 320 },
        children: [new TextRun({ text: ft, size: 18, color: '888888' })],
      })
    )
  }
  const doc = new Document({ sections: [{ children }] })
  await taskCheckpoint(task, '正在打包 Word', pages.length, pages.length)
  const blob = await Packer.toBlob(doc)
  checkTask(task)
  download(blob, `${title || '明白纸'}.docx`)
}

/** 预览与导出共用的排版、分页及栅格化管线。 */
export async function renderDocument(
  title: string, pages: Page[], style: ExportStyle, footer: ExportFooter,
  format: 'long' | 'pdf', imageScale = style.stepImageScale / 100, task: RenderTask = {},
): Promise<HTMLCanvasElement[]> {
  return documentQueue.run(task, () => renderDocumentJob(title, pages, style, footer, format, imageScale, task))
}

async function renderDocumentJob(title: string, pages: Page[], style: ExportStyle, footer: ExportFooter, format: 'long' | 'pdf', imageScale: number, task: RenderTask): Promise<HTMLCanvasElement[]> {
  checkTask(task)
  const width = 840
  const padding = 48
  const maxHeight = format === 'pdf' ? 1188 : 7000
  const root = document.createElement('div')
  root.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;padding:${padding}px;box-sizing:border-box;background:white;font-family:${FONT};color:#111827;`
  root.setAttribute('aria-hidden', 'true')
  document.body.appendChild(root)
  const result: HTMLCanvasElement[] = []
  const urls = new Set<string>()
  let outputIndex = 0
  const clearRoot = () => {
    root.querySelectorAll('img').forEach(img => { if (urls.delete(img.src)) URL.revokeObjectURL(img.src) })
    root.replaceChildren()
  }
  const emit = async (source: HTMLCanvasElement) => {
    let canvas = source
    try {
      checkTask(task)
      if (format === 'pdf') {
        canvas = document.createElement('canvas')
        canvas.width = width; canvas.height = maxHeight
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, maxHeight); ctx.drawImage(source, 0, 0)
        releaseCanvas(source)
      }
      if (task.onCanvas) await task.onCanvas(canvas, outputIndex++)
      else { result.push(canvas); outputIndex++ }
      checkTask(task)
    } finally {
      if (task.onCanvas || task.signal?.aborted) releaseCanvas(canvas)
    }
  }
  const capture = async () => {
    if (!root.childElementCount) return
    await taskCheckpoint(task, '正在生成输出页', outputIndex, outputIndex + 1)
    const canvas = await html2canvas(root, { backgroundColor: '#ffffff', scale: 1 })
    await emit(canvas)
    clearRoot()
  }
  const append = async (block: HTMLElement) => {
    root.appendChild(block)
    if (format === 'pdf' && root.getBoundingClientRect().height > maxHeight) {
      const img = block.querySelector('img')
      const available = maxHeight - root.getBoundingClientRect().height + (img?.getBoundingClientRect().height ?? 0)
      if (img && available >= 180) {
        img.style.maxHeight = `${available}px`
        img.style.objectFit = 'contain'
      }
    }
    if (root.getBoundingClientRect().height <= maxHeight) return
    block.remove()
    await capture()
    root.appendChild(block)
    if (root.getBoundingClientRect().height <= maxHeight) return
    // 单个超长步骤也分片，避免超出浏览器画布尺寸限制。
    const fullHeight = Math.ceil(block.getBoundingClientRect().height)
    block.remove()
    const viewport = document.createElement('div')
    const sliceHeight = maxHeight - padding * 2
    viewport.style.cssText = `height:${sliceHeight}px;overflow:hidden;position:relative;`
    root.appendChild(viewport)
    viewport.appendChild(block)
    for (let offset = 0; offset < fullHeight; offset += sliceHeight) {
      viewport.style.height = `${Math.min(sliceHeight, fullHeight - offset)}px`
      block.style.transform = `translateY(-${offset}px)`
      await taskCheckpoint(task, '正在切分长步骤', offset, fullHeight)
      await emit(await html2canvas(root, { backgroundColor: '#ffffff', scale: 1 }))
    }
    clearRoot()
  }
  try {
    await document.fonts.ready
    checkTask(task)
    const heading = document.createElement('h1')
    heading.textContent = title || '明白纸'
    heading.style.cssText = `font-size:${style.title}px;font-weight:700;text-align:${style.titleAlign};margin:0 0 20px;overflow-wrap:anywhere;`
    root.appendChild(heading)
    const starts = computeNumberStarts(pages)
    for (let i = 0; i < pages.length; i++) {
      await taskCheckpoint(task, '正在渲染步骤', i, pages.length)
      const page = pages[i]
      const block = document.createElement('section')
      block.style.cssText = 'padding-top:24px;'
      const h = document.createElement('h2')
      h.textContent = `步骤 ${i + 1}`
      h.style.cssText = `font-size:${style.heading}px;font-weight:700;text-align:${style.headingAlign};margin:0 0 8px;`
      block.appendChild(h)
      if (page.notes) {
        const notes = document.createElement('div')
        notes.innerHTML = safeNotesHtml(page)
        notes.style.cssText = `font-size:${style.notes}px;line-height:1.7;text-align:${style.notesAlign};overflow-wrap:anywhere;margin:0 0 12px;`
        notes.querySelectorAll<HTMLElement>('p').forEach(p => { p.style.margin = '0 0 .4em' })
        notes.querySelectorAll('ul, ol').forEach(list => {
          const element = list as HTMLElement
          element.style.cssText = `list-style-type:${element.tagName === 'UL' ? 'disc' : 'decimal'};padding-left:1.5em;margin:0 0 .5em;text-align:${style.notesAlign};`
        })
        notes.querySelectorAll<HTMLElement>('li p').forEach(p => { p.style.margin = '0' })
        block.appendChild(notes)
      }
      const canvas = await renderPageToCanvas(page, starts.get(page.id) ?? 0)
      const img = document.createElement('img')
      try { img.src = URL.createObjectURL(await canvasBlob(canvas, task)); urls.add(img.src) } finally { releaseCanvas(canvas) }
      img.style.cssText = `display:block;width:${Math.max(.25, Math.min(1, imageScale)) * 100}%;height:auto;margin:0 auto;`
      await img.decode()
      checkTask(task)
      block.appendChild(img)
      await append(block)
    }
    const ft = footerText(footer)
    if (ft) {
      const el = document.createElement('div')
      el.textContent = ft
      el.style.cssText = 'padding-top:28px;font-size:12px;color:#666;overflow-wrap:anywhere;'
      await append(el)
    }
    await capture()
    return result
  } catch (err) {
    result.forEach(releaseCanvas)
    throw err
  } finally {
    for (const url of urls) URL.revokeObjectURL(url)
    root.remove()
  }
}

export async function exportPdf(title: string, pages: Page[], style: ExportStyle = DEFAULT_EXPORT_STYLE, footer: ExportFooter = DEFAULT_EXPORT_FOOTER, imageScale = 1, task: RenderTask = {}) {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  await renderDocument(title, pages, style, footer, 'pdf', imageScale, { ...task, onCanvas: async (canvas, i) => {
    await taskCheckpoint(task, '正在编码 PDF 页', i, i + 1)
    if (i) pdf.addPage()
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight())
  } })
  await taskCheckpoint(task, '正在打包 PDF', pages.length, pages.length)
  pdf.save(`${title || '明白纸'}.pdf`)
}

export async function exportLongImage(title: string, pages: Page[], style: ExportStyle = DEFAULT_EXPORT_STYLE, footer: ExportFooter = DEFAULT_EXPORT_FOOTER, imageScale = 1, task: RenderTask = {}) {
  const blobs: Blob[] = []
  await renderDocument(title, pages, style, footer, 'long', imageScale, { ...task, onCanvas: async (canvas, index) => {
    await taskCheckpoint(task, '正在编码长图', index, index + 1)
    blobs.push(await canvasBlob(canvas, task))
  } })
  // 全部生成后再下载，取消时不留下只生成一半的文件组。
  for (let i = 0; i < blobs.length; i++) {
    checkTask(task)
    download(blobs[i], `${title || '明白纸'}-长图${blobs.length > 1 ? `-${i + 1}` : ''}.png`)
  }
}

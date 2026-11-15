import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import type { ExportFooter, ExportStyle, Page } from '@/types'
import { computeNumberStarts, DEFAULT_EXPORT_FOOTER, DEFAULT_EXPORT_STYLE } from '@/types'
import { checkTask, taskCheckpoint, releaseCanvas, type RenderTask } from './render-task'
import { dataUrlToBase64, renderPageToCanvas } from './render'
import { notesColor, notesFontSize, notesLineHeight, safeNotesHtml } from './notes'
import { download, footerText } from './export-common'
const DOC_MAX_WIDTH = 560

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
  await download(blob, `${title || '明白纸'}.docx`, task.signal)
}

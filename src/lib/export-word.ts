import { AlignmentType, BorderStyle, Document, HeadingLevel, HeightRule, ImageRun, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, VerticalAlign } from 'docx'
import { createDocumentHeader, createStepMarker, documentRows, stepHeadingParts } from './document-layout'
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
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: wordAlignment(style.titleAlign ?? 'left'),
      children: [new TextRun({ text: title || '明白纸', bold: true, size: Math.round(style.title * 2), color: style.header?.textColor.slice(1) })],
    }),
  ]
  if (style.header) {
    const header = style.header
    if (header.background !== 'plain' || header.logo) {
      const { default: html2canvas } = await import('html2canvas')
      const root = document.createElement('div')
      root.style.cssText = 'position:fixed;left:-10000px;top:0;width:744px;background:white;font-family:"Microsoft YaHei",sans-serif;'
      document.body.appendChild(root)
      try {
        await document.fonts.ready
        root.appendChild(await createDocumentHeader(title, style))
        checkTask(task)
        const canvas = await html2canvas(root, { backgroundColor: '#ffffff', scale: 1 })
        try {
          const ratio = Math.min(DOC_MAX_WIDTH / canvas.width, 720 / canvas.height)
          children.splice(0, children.length, new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: 'png', data: dataUrlToBase64(canvas.toDataURL('image/png')), transformation: { width: Math.round(canvas.width * ratio), height: Math.round(canvas.height * ratio) } })] }))
        } finally { releaseCanvas(canvas) }
      } finally { root.remove() }
    } else {
      const paragraphs = children.splice(0) as Paragraph[]
      if (header.subtitle) paragraphs.push(new Paragraph({ alignment: wordAlignment(style.titleAlign), children: [new TextRun({ text: header.subtitle, size: 24, color: header.textColor.slice(1) })] }))
      const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ height: { value: header.height * 15, rule: HeightRule.ATLEAST }, children: [new TableCell({ children: paragraphs, verticalAlign: VerticalAlign.CENTER, margins: { top: 360, bottom: 360, left: 360, right: 360 }, borders: { top: none, bottom: none, left: none, right: none } })] })] }))
    }
  }
  const starts = computeNumberStarts(pages)
  const layout = style.layout ?? 'top'
  const columns = layout === 'three' ? 3 : layout === 'two' || layout === 'shared' ? 2 : 1
  const border = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
  const borders = { top: border, bottom: border, left: border, right: border }
  const cell = (items: Paragraph[], percent: number) => new TableCell({ width: { size: percent, type: WidthType.PERCENTAGE }, borders, verticalAlign: VerticalAlign.TOP, margins: { top: 100, bottom: 100, left: 100, right: 100 }, children: items })
  let i = 0
  for (const row of documentRows(pages, layout)) {
    await taskCheckpoint(task, '正在生成 Word 步骤', i, pages.length)
    const copies: Paragraph[][] = [], pictures: Paragraph[] = []
    for (let column = 0; column < row.length; column++) {
    const page = row[column]
    const copy: Paragraph[] = []
    const heading = stepHeadingParts(i + column, layout === 'shared' ? row.length : 1, page.name, style)
    const headingRuns: (TextRun | ImageRun)[] = []
    if (heading.kind === 'text') headingRuns.push(new TextRun({ text: `${heading.label} ${heading.number}`, bold: true, size: Math.round(style.heading * 2) }))
    else {
      const marker = createStepMarker(heading.number, style)
      try {
        const number = new ImageRun({ type: 'png', data: dataUrlToBase64(marker.toDataURL('image/png')), transformation: { width: marker.width / 2, height: marker.height / 2 } })
        const label = new TextRun({ text: heading.kind === 'circle' ? `  ${heading.label}` : `${heading.label}  `, bold: true, size: Math.round(style.heading * 2) })
        headingRuns.push(...(heading.kind === 'circle' ? [number, label] : [label, number]))
      } finally { releaseCanvas(marker) }
    }
    if (layout !== 'shared' || column === 0) copy.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        alignment: wordAlignment(style.headingAlign ?? 'left'),
        spacing: { before: 320 },
        children: headingRuns,
      }))
    if (page.notes) {
      copy.push(
        ...wordNotes(page, style),
        new Paragraph({ children: [new TextRun('')] })
      )
    }
    copies.push(copy)
    const canvas = await renderPageToCanvas(page, starts.get(page.id) ?? 0)
    let dataUrl: string
    try { checkTask(task); dataUrl = canvas.toDataURL('image/png') } finally { releaseCanvas(canvas) }
    const available = layout === 'left' || layout === 'right' ? DOC_MAX_WIDTH * (1 - (style.textWidth ?? 40) / 100) - 16 : DOC_MAX_WIDTH / columns - (columns > 1 ? 16 : 0)
    const ratio = Math.min(1, available / page.width)
    pictures.push(
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
    if (layout === 'top') children.push(...copies[0], pictures[0])
    else if (layout === 'left' || layout === 'right') {
      const textWidth = style.textWidth ?? 40
      const cells = [cell(copies[0].length ? copies[0] : [new Paragraph('')], textWidth), cell([pictures[0]], 100 - textWidth)]
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: layout === 'left' ? cells : cells.reverse() })] }))
    } else {
      const rows: TableRow[] = []
      if (layout === 'shared') children.push(...copies.flat())
      while (copies.length < columns) copies.push([new Paragraph('')])
      while (pictures.length < columns) pictures.push(new Paragraph(''))
      if (layout !== 'shared') rows.push(new TableRow({ children: copies.map(copy => cell(copy.length ? copy : [new Paragraph('')], 100 / columns)) }))
      rows.push(new TableRow({ children: pictures.map(picture => cell([picture], 100 / columns)) }))
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }))
    }
    i += row.length
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

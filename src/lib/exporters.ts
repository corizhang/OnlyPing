import { AlignmentType, Document, HeadingLevel, ImageRun, Packer, Paragraph, TextRun } from 'docx'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { ExportFooter, ExportStyle, Page } from '@/types'
import { computeNumberStarts, DEFAULT_EXPORT_FOOTER, DEFAULT_EXPORT_STYLE } from '@/types'
import { dataUrlToBase64, renderPageToCanvas } from './render'

function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

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

/** 导出 Word：标题 + 每页「步骤 N 说明 + 标注后截图 + 文字」 */
export async function exportDocx(title: string, pages: Page[], style: ExportStyle = DEFAULT_EXPORT_STYLE, footer: ExportFooter = DEFAULT_EXPORT_FOOTER, imageScale = 1) {
  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: wordAlignment(style.titleAlign ?? 'left'),
      children: [new TextRun({ text: title || '明白纸', bold: true, size: Math.round(style.title * 2) })],
    }),
  ]
  const starts = computeNumberStarts(pages)
  for (let i = 0; i < pages.length; i++) {
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
        new Paragraph({
          alignment: wordAlignment(style.notesAlign ?? 'left'),
          children: page.notes.split(/\r?\n/).map((text, i) => new TextRun({ text, break: i ? 1 : 0, size: Math.round(style.notes * 2) })),
        }),
        new Paragraph({ children: [new TextRun('')] })
      )
    }
    const canvas = await renderPageToCanvas(page, starts.get(page.id) ?? 0)
    const dataUrl = canvas.toDataURL('image/png')
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
  const blob = await Packer.toBlob(doc)
  download(blob, `${title || '明白纸'}.docx`)
}

/** 预览与导出共用的排版、分页及栅格化管线。 */
export async function renderDocument(
  title: string, pages: Page[], style: ExportStyle, footer: ExportFooter,
  format: 'long' | 'pdf', imageScale = style.stepImageScale / 100,
): Promise<HTMLCanvasElement[]> {
  const width = 840
  const padding = 48
  const maxHeight = format === 'pdf' ? 1188 : 7000
  const root = document.createElement('div')
  root.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;padding:${padding}px;box-sizing:border-box;background:white;font-family:${FONT};color:#111827;`
  root.setAttribute('aria-hidden', 'true')
  document.body.appendChild(root)
  const result: HTMLCanvasElement[] = []
  const capture = async () => {
    if (!root.childElementCount) return
    const canvas = await html2canvas(root, { backgroundColor: '#ffffff', scale: 1 })
    result.push(canvas)
    root.replaceChildren()
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
      result.push(await html2canvas(root, { backgroundColor: '#ffffff', scale: 1 }))
    }
    root.replaceChildren()
  }
  try {
    await document.fonts.ready
    const heading = document.createElement('h1')
    heading.textContent = title || '明白纸'
    heading.style.cssText = `font-size:${style.title}px;font-weight:700;text-align:${style.titleAlign};margin:0 0 20px;overflow-wrap:anywhere;`
    root.appendChild(heading)
    const starts = computeNumberStarts(pages)
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i]
      const block = document.createElement('section')
      block.style.cssText = 'padding-top:24px;'
      const h = document.createElement('h2')
      h.textContent = `步骤 ${i + 1}`
      h.style.cssText = `font-size:${style.heading}px;font-weight:700;text-align:${style.headingAlign};margin:0 0 8px;`
      block.appendChild(h)
      if (page.notes) {
        const notes = document.createElement('p')
        notes.textContent = page.notes
        notes.style.cssText = `font-size:${style.notes}px;line-height:1.7;text-align:${style.notesAlign};white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 12px;`
        block.appendChild(notes)
      }
      const canvas = await renderPageToCanvas(page, starts.get(page.id) ?? 0)
      const img = document.createElement('img')
      img.src = canvas.toDataURL('image/png')
      img.style.cssText = `display:block;width:${Math.max(.25, Math.min(1, imageScale)) * 100}%;height:auto;margin:0 auto;`
      await img.decode()
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
    if (format === 'pdf') {
      return result.map(canvas => {
        const sheet = document.createElement('canvas')
        sheet.width = width
        sheet.height = maxHeight
        const ctx = sheet.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, maxHeight)
        ctx.drawImage(canvas, 0, 0)
        return sheet
      })
    }
    return result
  } finally {
    root.remove()
  }
}

export async function exportPdf(title: string, pages: Page[], style: ExportStyle = DEFAULT_EXPORT_STYLE, footer: ExportFooter = DEFAULT_EXPORT_FOOTER, imageScale = 1) {
  const canvases = await renderDocument(title, pages, style, footer, 'pdf', imageScale)
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  canvases.forEach((canvas, i) => {
    if (i) pdf.addPage()
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight())
  })
  pdf.save(`${title || '明白纸'}.pdf`)
}

export async function exportLongImage(title: string, pages: Page[], style: ExportStyle = DEFAULT_EXPORT_STYLE, footer: ExportFooter = DEFAULT_EXPORT_FOOTER, imageScale = 1) {
  const canvases = await renderDocument(title, pages, style, footer, 'long', imageScale)
  for (let i = 0; i < canvases.length; i++) {
    const blob = await new Promise<Blob>((resolve, reject) => canvases[i].toBlob(value => value ? resolve(value) : reject(new Error('图片编码失败'))))
    download(blob, `${title || '明白纸'}-长图${canvases.length > 1 ? `-${i + 1}` : ''}.png`)
  }
}

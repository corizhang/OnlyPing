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
          children: [new TextRun({ text: page.notes, size: Math.round(style.notes * 2) })],
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

/** 构建导出用的离屏 DOM（标题 + 图文步骤 + 页脚） */
function buildExportDom(
  title: string,
  pages: Page[],
  width: number,
  style: ExportStyle = DEFAULT_EXPORT_STYLE,
  footer: ExportFooter = DEFAULT_EXPORT_FOOTER,
  imageScale = 1
): HTMLElement {
  const starts = computeNumberStarts(pages)
  const root = document.createElement('div')
  root.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;background:#ffffff;padding:40px 48px;font-family:${FONT};color:#111827;`

  const h1 = document.createElement('h1')
  h1.textContent = title || '明白纸'
  h1.style.cssText = `font-size:${style.title}px;font-weight:700;text-align:${style.titleAlign ?? 'left'};margin:0 0 8px;`
  root.appendChild(h1)

  pages.forEach((page, i) => {
    const wrap = document.createElement('div')
    wrap.style.cssText = 'margin-top:32px;'
    const h2 = document.createElement('h2')
    h2.textContent = `步骤 ${i + 1}`
    h2.style.cssText = `font-size:${style.heading}px;font-weight:700;text-align:${style.headingAlign ?? 'left'};margin:0 0 8px;`
    wrap.appendChild(h2)
    if (page.notes) {
      const p = document.createElement('p')
      p.textContent = page.notes
      p.style.cssText = `font-size:${style.notes}px;line-height:1.7;text-align:${style.notesAlign ?? 'left'};margin:0 0 12px;`
      wrap.appendChild(p)
    }
    const img = document.createElement('img')
    img.style.cssText = `width:${Math.max(0.25, Math.min(1, imageScale)) * 100}%;height:auto;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;display:block;`
    wrap.appendChild(img)
    renderPageToCanvas(page, starts.get(page.id) ?? 0).then((canvas) => {
      const ratio = width / page.width
      img.src = canvas.toDataURL('image/png')
      img.width = width
      img.height = Math.round(page.height * ratio)
    })
    root.appendChild(wrap)
  })
  const ft = footerText(footer)
  if (ft) {
    const foot = document.createElement('div')
    foot.textContent = ft
    foot.style.cssText = `margin-top:40px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px;`
    root.appendChild(foot)
  }
  document.body.appendChild(root)
  return root
}

function waitForImages(root: HTMLElement) {
  const imgs = Array.from(root.querySelectorAll('img'))
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete && img.naturalWidth > 0) resolve()
          else {
            img.onload = () => resolve()
            img.onerror = () => resolve()
          }
        })
    )
  )
}

/** 导出 PDF：每页一个 A4 版式 */
export async function exportPdf(title: string, pages: Page[], style: ExportStyle = DEFAULT_EXPORT_STYLE, footer: ExportFooter = DEFAULT_EXPORT_FOOTER, imageScale = 1) {
  const width = 700
  const root = buildExportDom(title, pages, width, style, footer, imageScale)
  await waitForImages(root)
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 36
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage()
    const blocks = root.children[i + 1] as HTMLElement // 0 是标题
    const canvas = await html2canvas(blocks, { backgroundColor: '#ffffff', scale: 2 })
    const availW = pageW - margin * 2
    const availH = pageH - margin * 2
    const ratio = Math.min(availW / canvas.width, availH / canvas.height)
    const w = canvas.width * ratio
    const h = canvas.height * ratio
    pdf.addImage(
      canvas.toDataURL('image/jpeg', 0.92),
      'JPEG',
      margin + (availW - w) / 2,
      margin,
      w,
      h
    )
  }
  // 页脚：渲染在最后一页底部
  const ftEl = root.children[pages.length + 1] as HTMLElement | undefined
  if (ftEl && footerText(footer)) {
    const canvas = await html2canvas(ftEl, { backgroundColor: '#ffffff', scale: 2 })
    const availW = pageW - margin * 2
    const w = Math.min(availW, canvas.width * 0.75)
    const h = (canvas.height / canvas.width) * w
    pdf.addImage(
      canvas.toDataURL('image/jpeg', 0.92),
      'JPEG',
      margin,
      pageH - margin - h,
      w,
      h
    )
  }
  document.body.removeChild(root)
  pdf.save(`${title || '明白纸'}.pdf`)
}

/** 导出长图：浏览器画布高度有限，超高时自动拆分为多张 */
export async function exportLongImage(title: string, pages: Page[], style: ExportStyle = DEFAULT_EXPORT_STYLE, footer: ExportFooter = DEFAULT_EXPORT_FOOTER, imageScale = 1) {
  const width = 840
  const MAX_HEIGHT = 14000
  const starts = computeNumberStarts(pages)
  const parts: HTMLElement[] = []
  let current: HTMLElement | null = null
  let currentH = 0

  const newPart = (): HTMLElement => {
    const el = document.createElement('div')
    el.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;background:#ffffff;padding:48px 56px;font-family:${FONT};color:#111827;`
    document.body.appendChild(el)
    parts.push(el)
    currentH = 96
    return el
  }

  current = newPart()
  const h1 = document.createElement('h1')
  h1.textContent = title || '明白纸'
  h1.style.cssText = `font-size:${style.title}px;font-weight:700;text-align:${style.titleAlign ?? 'left'};margin:0 0 16px;`
  current.appendChild(h1)

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i]
    const canvas = await renderPageToCanvas(page, starts.get(page.id) ?? 0)
    const blockH = 60 + (page.notes ? style.notes * 3 : 0) + (width * imageScale / page.width) * page.height
    if (currentH + blockH > MAX_HEIGHT) current = newPart()
    const wrap = document.createElement('div')
    wrap.style.cssText = 'margin-top:40px;'
    const h2 = document.createElement('h2')
    h2.textContent = `步骤 ${i + 1}`
    h2.style.cssText = `font-size:${style.heading}px;font-weight:700;text-align:${style.headingAlign ?? 'left'};margin:0 0 8px;`
    wrap.appendChild(h2)
    if (page.notes) {
      const p = document.createElement('p')
      p.textContent = page.notes
      p.style.cssText = `font-size:${style.notes}px;line-height:1.7;text-align:${style.notesAlign ?? 'left'};margin:0 0 12px;`
      wrap.appendChild(p)
    }
    const img = document.createElement('img')
    img.src = canvas.toDataURL('image/png')
    img.width = width
    img.height = Math.round((width / page.width) * page.height)
    img.style.cssText = `width:${Math.max(0.25, Math.min(1, imageScale)) * 100}%;height:auto;margin:0 auto;border:1px solid #e5e7eb;border-radius:8px;display:block;`
    wrap.appendChild(img)
    current!.appendChild(wrap)
    currentH += blockH
  }

  // 页脚追加到最后一张图
  const ft = footerText(footer)
  if (ft) {
    const foot = document.createElement('div')
    foot.textContent = ft
    foot.style.cssText = `margin-top:40px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px;`
    current!.appendChild(foot)
  }

  await waitForImages(document.body as unknown as HTMLElement)
  for (let i = 0; i < parts.length; i++) {
    const canvas = await html2canvas(parts[i], { backgroundColor: '#ffffff' })
    const a = document.createElement('a')
    a.download = parts.length > 1 ? `${title || '明白纸'}-长图-${i + 1}.png` : `${title || '明白纸'}-长图.png`
    a.href = canvas.toDataURL('image/png')
    a.click()
    document.body.removeChild(parts[i])
  }
}

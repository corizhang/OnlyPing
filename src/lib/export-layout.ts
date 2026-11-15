import html2canvas from 'html2canvas'
import type { ExportFooter, ExportStyle, Page } from '@/types'
import { computeNumberStarts } from '@/types'
import { RenderQueue, checkTask, taskCheckpoint, releaseCanvas, canvasBlob, type RenderTask } from './render-task'
import { renderPageToCanvas } from './render'
import { safeNotesHtml } from './notes'
import { footerText } from './export-common'
const documentQueue = new RenderQueue()
const FONT = '"PingFang SC", "Microsoft YaHei", sans-serif'

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
    if (root.getBoundingClientRect().height <= maxHeight) return
    block.remove()
    await capture()
    root.appendChild(block)
    // Fit on a fresh page. Explicit dimensions preserve the screenshot's aspect
    // ratio; max-height with a percentage width can leave an oversized layout box.
    if (format === 'pdf' && root.getBoundingClientRect().height > maxHeight) {
      const img = block.querySelector('img')
      const rect = img?.getBoundingClientRect()
      const available = Math.floor(maxHeight - root.getBoundingClientRect().height + (rect?.height ?? 0)) - 1
      if (img && available >= 180) {
        img.style.width = `${rect!.width * available / rect!.height}px`
        img.style.height = `${available}px`
      }
    }
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

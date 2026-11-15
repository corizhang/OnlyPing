import { canvasBlob, checkTask, releaseCanvas, taskCheckpoint, type RenderTask } from './render-task'
import { drawAreaAnnotation, isAreaKind } from './tools/area'
import { drawMarkAnnotation, isMarkAnnotation } from './tools/mark'
import { drawContentAnnotation, isContentAnnotation } from './tools/content'
export { mosaicCanvasRegion } from './pixelate'
import type { Page } from '@/types'
import { magnifierTool } from './tools/magnifier'
import { startEditorPhase } from './editor-performance'
import { saveFile } from './files'

const imageCache = new Map<string, Promise<HTMLImageElement>>()
const imagePixels = new Map<string, number>()
function removeCachedImage(src: string) { imageCache.delete(src); imagePixels.delete(src) }
function trimImageCache() {
  let pixels = [...imagePixels.values()].reduce((sum, n) => sum + n, 0)
  while (imageCache.size > 1 && (imageCache.size > 12 || pixels > 40_000_000)) {
    const oldest = imageCache.keys().next().value!
    pixels -= imagePixels.get(oldest) ?? 0
    removeCachedImage(oldest)
  }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = imageCache.get(src)
  if (p) { imageCache.delete(src); imageCache.set(src, p) }
  if (!p) {
    const finish = startEditorPhase('image-load')
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        finish()
        if (imageCache.get(src) === p) { imagePixels.set(src, (img.naturalWidth || 0) * (img.naturalHeight || 0)); trimImageCache() }
        resolve(img)
      }
      img.onerror = () => { finish(); if (imageCache.get(src) === p) removeCachedImage(src); reject(new Error('图片加载失败')) }
      img.src = src
    })
    imageCache.set(src, p)
    trimImageCache()
  }
  return p
}

export function clearImageCache() { imageCache.clear(); imagePixels.clear() }

/** 把一页（底图 + 全部标注）按原始尺寸渲染成一个画布；numberStart 为全局序号起始值 */
export async function renderPageToCanvas(page: Page, numberStart = 0): Promise<HTMLCanvasElement> {
  page = { ...page, annotations: page.annotations.filter(a => !a.hidden) }
  // 所有放大镜从同一张不含放大镜的完整合成图取样，避免层级或重叠改变内容。
  const magnifierSource = page.annotations.some(a => a.kind === 'magnifier')
    ? await renderPageToCanvas({ ...page, annotations: page.annotations.filter(a => a.kind !== 'magnifier') }, numberStart)
    : null
  const img = await loadImage(page.image)
  const canvas = document.createElement('canvas')
  canvas.width = page.width
  canvas.height = page.height
  const ctx = canvas.getContext('2d')!
  try {
    ctx.drawImage(img, 0, 0)

    for (const ann of page.annotations) {
      if (ann.kind === 'mosaic') {
        drawAreaAnnotation(ctx, ann, canvas)
      }
    }
    for (const ann of page.annotations) {
      if (ann.kind === 'redact') {
        drawAreaAnnotation(ctx, ann, canvas)
      }
    }

    const numbers = page.annotations.filter((a) => a.kind === 'number')
    const numIndex = new Map<string, number>()
    numbers.forEach((n, i) => numIndex.set(n.id, i + 1))

    for (const ann of page.annotations) {
      if (isAreaKind(ann.kind)) {
        if (ann.kind !== 'mosaic' && ann.kind !== 'redact') drawAreaAnnotation(ctx, ann, canvas)
      } else if (isMarkAnnotation(ann)) {
        drawMarkAnnotation(ctx, ann, (numIndex.get(ann.id) ?? 1) + numberStart)
      } else if (ann.kind === 'magnifier' && magnifierSource) {
        magnifierTool.draw(ctx, ann, magnifierSource)
      } else if (isContentAnnotation(ann)) {
        drawContentAnnotation(ctx, ann, canvas)
      }
    }
    return canvas
  } catch (err) { releaseCanvas(canvas); throw err }
  finally { if (magnifierSource) releaseCanvas(magnifierSource) }
}

/** 隐私模式下，把现有马赛克和标注渲染进图像后再交给 AI。 */
export async function preparePageForAI(page: Page, privacy: boolean): Promise<Page> {
  const protectedPage = privacy ? page : { ...page, annotations: page.annotations.filter(a => a.kind === 'mosaic' || a.kind === 'redact') }
  const canvas = await renderPageToCanvas({ ...protectedPage, annotations: protectedPage.annotations.map(a => a.kind === 'mosaic' || a.kind === 'redact' ? { ...a, hidden: false } : a) })
  try { return { ...page, image: canvas.toDataURL('image/jpeg', 0.85) } } finally { releaseCanvas(canvas) }
}

/** 渲染单页并导出 PNG 下载 */
export async function downloadPageImage(page: Page, numberStart = 0, task: RenderTask = {}) {
  await taskCheckpoint(task, '正在渲染截图', 0, 1)
  const canvas = await renderPageToCanvas(page, numberStart)
  try {
    const blob = await canvasBlob(canvas, task)
    checkTask(task)
    await saveFile(blob, `${page.name || 'page'}-标注.png`, task.signal)
  } finally { releaseCanvas(canvas) }
}

export function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, '')
}

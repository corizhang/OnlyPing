import { drawAreaAnnotation, isAreaKind } from './tools/area'
import { drawMarkAnnotation, isMarkAnnotation } from './tools/mark'
import { drawContentAnnotation, isContentAnnotation } from './tools/content'
export { mosaicCanvasRegion } from './pixelate'
import type { Page } from '@/types'

const imageCache = new Map<string, Promise<HTMLImageElement>>()

export function loadImage(src: string): Promise<HTMLImageElement> {
  let p = imageCache.get(src)
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = src
    })
    imageCache.set(src, p)
  }
  return p
}

/** 把一页（底图 + 全部标注）按原始尺寸渲染成一个画布；numberStart 为全局序号起始值 */
export async function renderPageToCanvas(page: Page, numberStart = 0): Promise<HTMLCanvasElement> {
  const img = await loadImage(page.image)
  const canvas = document.createElement('canvas')
  canvas.width = page.width
  canvas.height = page.height
  const ctx = canvas.getContext('2d')!
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
      if (ann.kind !== 'mosaic') drawAreaAnnotation(ctx, ann, canvas)
    } else if (isMarkAnnotation(ann)) {
      drawMarkAnnotation(ctx, ann, (numIndex.get(ann.id) ?? 1) + numberStart)
    } else if (isContentAnnotation(ann)) {
      drawContentAnnotation(ctx, ann, canvas)
    }
  }
  return canvas
}

/** 隐私模式下，把现有马赛克和标注渲染进图像后再交给 AI。 */
export async function preparePageForAI(page: Page, privacy: boolean): Promise<Page> {
  const protectedPage = privacy ? page : { ...page, annotations: page.annotations.filter(a => a.kind === 'mosaic' || a.kind === 'redact') }
  const canvas = await renderPageToCanvas(protectedPage)
  return { ...page, image: canvas.toDataURL('image/jpeg', 0.85) }
}

/** 渲染单页并导出 PNG 下载 */
export async function downloadPageImage(page: Page, numberStart = 0) {
  const canvas = await renderPageToCanvas(page, numberStart)
  const a = document.createElement('a')
  a.download = `${page.name || 'page'}-标注.png`
  a.href = canvas.toDataURL('image/png')
  a.click()
}

export function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.replace(/^data:image\/\w+;base64,/, '')
}

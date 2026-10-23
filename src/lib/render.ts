import type { ArrowAnnotation, Page } from '@/types'
import { ARROW_DEFAULT_WIDTH, MOSAIC_DEFAULT_TILE } from '@/types'

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

/** 把 canvas 上的 (ix,iy,iw,ih) 区域像素化（从 canvas 自身取样后放大回铺）；tile 为块大小，越大越模糊 */
export function mosaicCanvasRegion(
  canvas: HTMLCanvasElement,
  ix: number,
  iy: number,
  iw: number,
  ih: number,
  tile: number = MOSAIC_DEFAULT_TILE
) {
  if (iw < 2 || ih < 2) return
  const ctx = canvas.getContext('2d')!
  const tw = Math.max(1, Math.round(iw / tile))
  const th = Math.max(1, Math.round(ih / tile))
  const tmp = document.createElement('canvas')
  tmp.width = tw
  tmp.height = th
  const tctx = tmp.getContext('2d')!
  tctx.drawImage(canvas, ix, iy, iw, ih, 0, 0, tw, th)
  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, ix, iy, iw, ih)
  ctx.restore()
}

/** 在画布上绘制一支箭头（线条 + 实心头部），与画布编辑器的 SVG 渲染保持一致 */
function drawArrow(ctx: CanvasRenderingContext2D, ann: ArrowAnnotation) {
  const w = ann.width ?? ARROW_DEFAULT_WIDTH
  ctx.save()
  ctx.strokeStyle = ann.color
  ctx.fillStyle = ann.color
  ctx.lineWidth = w
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(ann.x1, ann.y1)
  ctx.lineTo(ann.x2, ann.y2)
  ctx.stroke()
  const ang = Math.atan2(ann.y2 - ann.y1, ann.x2 - ann.x1)
  const len = w * 3.2
  const half = w * 1.7
  const bx = ann.x2 - len * Math.cos(ang)
  const by = ann.y2 - len * Math.sin(ang)
  const nx = -Math.sin(ang)
  const ny = Math.cos(ang)
  ctx.beginPath()
  ctx.moveTo(ann.x2, ann.y2)
  ctx.lineTo(bx + half * nx, by + half * ny)
  ctx.lineTo(bx - half * nx, by - half * ny)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
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
      mosaicCanvasRegion(canvas, Math.round(ann.x), Math.round(ann.y), Math.round(ann.w), Math.round(ann.h), ann.tile ?? MOSAIC_DEFAULT_TILE)
    }
  }

  const numbers = page.annotations.filter((a) => a.kind === 'number')
  const numIndex = new Map<string, number>()
  numbers.forEach((n, i) => numIndex.set(n.id, i + 1))

  for (const ann of page.annotations) {
    if (ann.kind === 'box') {
      ctx.save()
      ctx.strokeStyle = ann.color
      ctx.lineWidth = 4
      ctx.fillStyle = ann.color + '22'
      ctx.beginPath()
      ctx.roundRect(ann.x, ann.y, ann.w, ann.h, 4)
      ctx.fill()
      ctx.stroke()
      ctx.restore()
    } else if (ann.kind === 'arrow') {
      drawArrow(ctx, ann)
    } else if (ann.kind === 'number') {
      const n = (numIndex.get(ann.id) ?? 1) + numberStart
      const r = ann.r ?? 20
      ctx.save()
      ctx.beginPath()
      ctx.arc(ann.x, ann.y, r, 0, Math.PI * 2)
      ctx.fillStyle = '#ef4444'
      ctx.fill()
      ctx.lineWidth = 4
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${r}px "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(n), ann.x, ann.y + 1)
      ctx.restore()
    } else if (ann.kind === 'text') {
      const size = ann.size ?? 26
      const lines = ann.text.split('\n')
      const lineH = Math.round(size * 1.3)
      ctx.save()
      ctx.font = `bold ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
      ctx.textBaseline = 'top'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'
      ctx.lineWidth = Math.max(4, size / 4)
      lines.forEach((line, i) => {
        const ly = ann.y + i * lineH
        ctx.strokeText(line, ann.x, ly)
        ctx.fillStyle = ann.color
        ctx.fillText(line, ann.x, ly)
      })
      ctx.restore()
    }
  }
  return canvas
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

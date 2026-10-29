import { MOSAIC_DEFAULT_TILE } from '@/types'

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

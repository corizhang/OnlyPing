import { mosaicCanvasRegion } from '@/lib/pixelate'
import { MOSAIC_DEFAULT_TILE } from '@/types'
import type { AreaTool } from './types'
import { rectHit } from './types'

export const mosaicTool: AreaTool<'mosaic'> = {
  kind: 'mosaic',
  create: (id, x, y, style) => ({ id, kind: 'mosaic', x, y, w: 0, h: 0, tile: style.mosaicTile }),
  hit: rectHit,
  draw: (_ctx, a, canvas) => {
    mosaicCanvasRegion(canvas, Math.round(a.x), Math.round(a.y), Math.round(a.w), Math.round(a.h), a.tile ?? MOSAIC_DEFAULT_TILE)
  },
  view: (a, selected) => (
    <rect
      x={a.x}
      y={a.y}
      width={a.w}
      height={a.h}
      fill="transparent"
      stroke={selected ? '#2563eb' : 'rgba(37,99,235,0.4)'}
      strokeWidth={selected ? 2.5 : 1.5}
      strokeDasharray="6 4"
    />
  ),
}

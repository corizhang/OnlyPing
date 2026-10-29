import type { AreaTool } from './types'
import { rectHit } from './types'

export const highlightTool: AreaTool<'highlight'> = {
  kind: 'highlight',
  create: (id, x, y, style) => ({ id, kind: 'highlight', x, y, w: 0, h: 0, color: style.color }),
  hit: rectHit,
  draw: (ctx, a) => {
    ctx.save()
    ctx.globalAlpha = 0.38
    ctx.fillStyle = a.color
    ctx.fillRect(a.x, a.y, a.w, a.h)
    ctx.restore()
  },
  view: (a) => (
    <rect x={a.x} y={a.y} width={a.w} height={a.h} fill={a.color} fillOpacity={0.38} />
  ),
}

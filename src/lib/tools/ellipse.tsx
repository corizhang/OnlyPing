import type { AreaTool } from './types'
import { rectHit } from './types'

export const ellipseTool: AreaTool<'ellipse'> = {
  kind: 'ellipse',
  create: (id, x, y, style) => ({ id, kind: 'ellipse', x, y, w: 0, h: 0, color: style.color }),
  hit: rectHit,
  draw: (ctx, a) => {
    ctx.save()
    ctx.strokeStyle = a.color
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, Math.abs(a.w / 2), Math.abs(a.h / 2), 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  },
  view: (a) => (
    <ellipse cx={a.x + a.w / 2} cy={a.y + a.h / 2} rx={a.w / 2} ry={a.h / 2} fill="none" stroke={a.color} strokeWidth={4} />
  ),
}

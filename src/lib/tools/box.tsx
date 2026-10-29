import type { AreaTool } from './types'
import { rectHit } from './types'

export const boxTool: AreaTool<'box'> = {
  kind: 'box',
  create: (id, x, y, style) => ({ id, kind: 'box', x, y, w: 0, h: 0, color: style.color }),
  hit: rectHit,
  draw: (ctx, a) => {
    ctx.save()
    ctx.strokeStyle = a.color
    ctx.lineWidth = 4
    ctx.fillStyle = a.color + '22'
    ctx.beginPath()
    ctx.roundRect(a.x, a.y, a.w, a.h, 4)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  },
  view: (a) => (
    <rect x={a.x} y={a.y} width={a.w} height={a.h} fill={a.color + '22'} stroke={a.color} strokeWidth={4} />
  ),
}

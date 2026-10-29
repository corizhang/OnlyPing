import { ARROW_DEFAULT_WIDTH } from '@/types'
import { distanceToSegment } from './geometry'
import type { MarkTool } from './types'

export const lineTool: MarkTool<'line'> = {
  kind: 'line',
  create: (id, x, y, style) => ({ id, kind: 'line', x1: x, y1: y, x2: x, y2: y, color: style.color, width: style.strokeWidth }),
  hit: (a, x, y) => distanceToSegment(x, y, a.x1, a.y1, a.x2, a.y2) <= Math.max(10, a.width ?? 4),
  draw: (ctx, a) => {
    ctx.save()
    ctx.strokeStyle = a.color
    ctx.lineWidth = a.width ?? 4
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(a.x1, a.y1)
    ctx.lineTo(a.x2, a.y2)
    ctx.stroke()
    ctx.restore()
  },
  view: (a) => (
    <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={a.color} strokeWidth={a.width ?? ARROW_DEFAULT_WIDTH} strokeLinecap="round" />
  ),
}

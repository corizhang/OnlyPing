import { distanceToSegment } from './geometry'
import type { MarkTool } from './types'

export const freehandTool: MarkTool<'freehand'> = {
  kind: 'freehand',
  create: (id, x, y, style) => ({ id, kind: 'freehand', points: [{ x, y }], color: style.color, width: style.strokeWidth }),
  hit: (a, x, y) => a.points.some((point, index) => index > 0 && distanceToSegment(x, y, a.points[index - 1].x, a.points[index - 1].y, point.x, point.y) <= Math.max(10, a.width ?? 4)),
  draw: (ctx, a) => {
    if (a.points.length < 2) return
    ctx.save()
    ctx.strokeStyle = a.color
    ctx.lineWidth = a.width ?? 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(a.points[0].x, a.points[0].y)
    a.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y))
    ctx.stroke()
    ctx.restore()
  },
  view: (a, { selected }) => {
    const points = a.points.map((point) => `${point.x},${point.y}`).join(' ')
    return (
      <>
        <polyline points={points} fill="none" stroke={a.color} strokeWidth={a.width ?? 4} strokeLinecap="round" strokeLinejoin="round" />
        {selected && <polyline points={points} fill="none" stroke="#2563eb" strokeWidth={Math.max(10, (a.width ?? 4) + 8)} strokeOpacity={0.18} strokeLinecap="round" strokeLinejoin="round" />}
      </>
    )
  },
}

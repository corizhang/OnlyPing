import { distanceToSegment } from './geometry'
import type { MarkTool } from './types'
import { freehandPath } from './stroke-geometry'

export const freehandTool: MarkTool<'freehand'> = {
  kind: 'freehand',
  create: (id, x, y, style) => ({ id, kind: 'freehand', points: [{ x, y }], color: style.color, width: style.strokeWidth, smoothed: style.smoothBrush ?? true }),
  hit: (a, x, y) => a.points.some((point, index) => index > 0 && distanceToSegment(x, y, a.points[index - 1].x, a.points[index - 1].y, point.x, point.y) <= Math.max(10, a.width ?? 4)),
  draw: (ctx, a) => {
    if (a.points.length < 2) return
    ctx.save()
    ctx.strokeStyle = a.color
    ctx.lineWidth = a.width ?? 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke(new Path2D(freehandPath(a)))
    ctx.restore()
  },
  view: (a, { selected }) => {
    const path = freehandPath(a)
    return (
      <>
        <path d={path} fill="none" stroke={a.color} strokeWidth={a.width ?? 4} strokeLinecap="round" strokeLinejoin="round" />
        {selected && <path d={path} fill="none" stroke="#2563eb" strokeWidth={Math.max(10, (a.width ?? 4) + 8)} strokeOpacity={0.18} strokeLinecap="round" strokeLinejoin="round" />}
      </>
    )
  },
}

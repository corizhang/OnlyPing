import type { AreaTool } from './types'
import { rectHit } from './types'

export const redactTool: AreaTool<'redact'> = {
  kind: 'redact',
  create: (id, x, y) => ({ id, kind: 'redact', x, y, w: 0, h: 0, color: '#111827' }),
  hit: rectHit,
  draw: (ctx, a) => {
    ctx.fillStyle = a.color
    ctx.fillRect(a.x, a.y, a.w, a.h)
  },
  view: (a) => (
    <rect x={a.x} y={a.y} width={a.w} height={a.h} fill={a.color} stroke={a.color} strokeWidth={1} />
  ),
}

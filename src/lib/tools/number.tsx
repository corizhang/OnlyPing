import type { MarkTool } from './types'
import { numberLayout } from './number-layout'

const DEFAULT_RADIUS = 20

export const numberTool: MarkTool<'number'> = {
  kind: 'number',
  create: (id, x, y, style) => ({ id, kind: 'number', x, y, r: style.numberR, color: style.color, badge: style.numberBadge ?? 'circle' }),
  hit: (a, x, y) => {
    const radius = a.r ?? DEFAULT_RADIUS
    const dx = x - a.x
    const dy = y - a.y
    return a.badge === 'square' ? Math.abs(dx) <= radius && Math.abs(dy) <= radius : dx * dx + dy * dy <= radius * radius
  },
  draw: (ctx, a, label) => {
    const { path, fill, stroke, text, fontSize, strokeWidth } = numberLayout(a, label)
    ctx.save()
    const outline = new Path2D(path)
    if (fill !== 'none') { ctx.fillStyle = fill; ctx.fill(outline) }
    ctx.lineWidth = strokeWidth
    ctx.strokeStyle = stroke
    ctx.stroke(outline)
    ctx.fillStyle = text
    ctx.font = `bold ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(label), a.x, a.y + 1)
    ctx.restore()
  },
  view: (a, { selected, label }) => {
    const { r: radius, path, fill, stroke, text, fontSize, strokeWidth } = numberLayout(a, label)
    return (
      <>
        <path d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
        <text x={a.x} y={a.y + 1} textAnchor="middle" dominantBaseline="middle" fill={text} fontSize={fontSize} fontWeight={700} fontFamily='"PingFang SC", "Microsoft YaHei", sans-serif' style={{ pointerEvents: 'none' }}>
          {label}
        </text>
        {selected && <circle cx={a.x} cy={a.y} r={radius + 6} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="5 4" />}
      </>
    )
  },
}

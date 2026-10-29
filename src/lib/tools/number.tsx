import type { MarkTool } from './types'

const DEFAULT_RADIUS = 20

export const numberTool: MarkTool<'number'> = {
  kind: 'number',
  create: (id, x, y, style) => ({ id, kind: 'number', x, y, r: style.numberR }),
  hit: (a, x, y) => {
    const radius = a.r ?? DEFAULT_RADIUS
    const dx = x - a.x
    const dy = y - a.y
    return dx * dx + dy * dy <= radius * radius
  },
  draw: (ctx, a, label) => {
    const radius = a.r ?? DEFAULT_RADIUS
    ctx.save()
    ctx.beginPath()
    ctx.arc(a.x, a.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = '#ef4444'
    ctx.fill()
    ctx.lineWidth = 4
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = `bold ${radius}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(label), a.x, a.y + 1)
    ctx.restore()
  },
  view: (a, { selected, label }) => {
    const radius = a.r ?? DEFAULT_RADIUS
    return (
      <>
        <circle cx={a.x} cy={a.y} r={radius} fill="#ef4444" stroke="#ffffff" strokeWidth={Math.max(3, radius / 6)} />
        <text x={a.x} y={a.y + 1} textAnchor="middle" dominantBaseline="middle" fill="#ffffff" fontSize={radius} fontWeight={700} fontFamily='"PingFang SC", "Microsoft YaHei", sans-serif' style={{ pointerEvents: 'none' }}>
          {label}
        </text>
        {selected && <circle cx={a.x} cy={a.y} r={radius + 6} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="5 4" />}
      </>
    )
  },
}

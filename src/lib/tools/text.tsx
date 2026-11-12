import type { ContentTool } from './types'

const measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')

function textBounds(a: { x: number; y: number; text: string; size?: number; background?: boolean }) {
  const size = a.size ?? 26
  const lineHeight = Math.round(size * 1.3)
  const lines = a.text.split('\n')
  if (measureContext) measureContext.font = `bold ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
  const textWidth = Math.max(size * 0.6, ...lines.map(line => measureContext
    ? measureContext.measureText(line).width
    : Array.from(line).length * size))
  return {
    size, lineHeight, lines, textWidth,
    x: a.x - (a.background ? 8 : 4),
    y: a.y - size - 6,
    w: textWidth + (a.background ? 16 : 12),
    h: lines.length * lineHeight + (a.background ? 14 : 12),
  }
}

export const textTool: ContentTool<'text'> = {
  kind: 'text',
  create: (id, x, y, style) => ({
    id,
    kind: 'text',
    x,
    y,
    text: style.text ?? '',
    color: style.color,
    size: style.textSize ?? 26,
    background: style.background ?? false,
  }),
  hit: (a, x, y) => {
    const bounds = textBounds(a)
    return x >= bounds.x && x <= bounds.x + bounds.w && y >= bounds.y && y <= bounds.y + bounds.h
  },
  draw: (ctx, a) => {
    const size = a.size ?? 26
    const lines = a.text.split('\n')
    const lineHeight = Math.round(size * 1.3)
    ctx.save()
    ctx.font = `bold ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.textBaseline = 'alphabetic'
    ctx.lineJoin = 'round'
    const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width), size * 0.6)
    if (a.background) {
      ctx.fillStyle = '#ffffff'
      ctx.strokeStyle = '#d1d5db'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(a.x - 6, a.y - size - 4, textWidth + 12, lines.length * lineHeight + 10, 4)
      ctx.fill()
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = Math.max(4, size / 4)
    lines.forEach((line, index) => {
      const lineY = a.y + index * lineHeight
      ctx.strokeText(line, a.x, lineY)
      ctx.fillStyle = a.color
      ctx.fillText(line, a.x, lineY)
    })
    ctx.restore()
  },
  view: (a, { selected }) => {
    const { size, lines, lineHeight, textWidth, x, y, w, h } = textBounds(a)
    return (
      <>
        {a.background && <rect x={a.x - 6} y={a.y - size - 4} width={textWidth + 12} height={lines.length * lineHeight + 10} rx={4} fill="#ffffff" stroke="#d1d5db" strokeWidth={1} />}
        <text x={a.x} y={a.y} fontSize={size} fontWeight={700} fill={a.color} stroke="rgba(255,255,255,0.95)" strokeWidth={Math.max(4, size / 4)} paintOrder="stroke" fontFamily='"PingFang SC", "Microsoft YaHei", sans-serif'>
          {lines.map((line, index) => <tspan key={index} x={a.x} dy={index === 0 ? 0 : lineHeight}>{line}</tspan>)}
        </text>
        {selected && (
          <rect
            x={x}
            y={y}
            width={w}
            height={h}
            fill="none"
            stroke="#2563eb"
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        )}
      </>
    )
  },
}

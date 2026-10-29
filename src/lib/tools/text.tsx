import type { ContentTool } from './types'

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
    const size = a.size ?? 26
    const lineHeight = Math.round(size * 1.3)
    const lines = a.text.split('\n')
    const maxLength = Math.max(...lines.map((line) => line.length), 1)
    const padX = a.background ? 12 : 4
    const top = a.background ? a.y - size - 6 : a.y - 6
    return x >= a.x - padX && x <= a.x + maxLength * size + padX && y >= top && y <= a.y + lines.length * lineHeight + 16
  },
  draw: (ctx, a) => {
    const size = a.size ?? 26
    const lines = a.text.split('\n')
    const lineHeight = Math.round(size * 1.3)
    ctx.save()
    ctx.font = `bold ${size}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.textBaseline = 'top'
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
    const size = a.size ?? 26
    const lines = a.text.split('\n')
    const lineHeight = Math.round(size * 1.3)
    const maxLength = Math.max(...lines.map((line) => line.length), 1)
    const textWidth = maxLength * size * 0.65
    const textHeight = lines.length * lineHeight
    return (
      <>
        {a.background && <rect x={a.x - 6} y={a.y - size - 4} width={textWidth + 12} height={textHeight + 10} rx={4} fill="#ffffff" stroke="#d1d5db" strokeWidth={1} />}
        <text x={a.x} y={a.y} fontSize={size} fontWeight={700} fill={a.color} stroke="rgba(255,255,255,0.95)" strokeWidth={Math.max(4, size / 4)} paintOrder="stroke" fontFamily='"PingFang SC", "Microsoft YaHei", sans-serif'>
          {lines.map((line, index) => <tspan key={index} x={a.x} dy={index === 0 ? 0 : lineHeight}>{line}</tspan>)}
        </text>
        {selected && (
          <rect
            x={a.x - (a.background ? 8 : 4)}
            y={a.y - (a.background ? size + 6 : 6)}
            width={textWidth + (a.background ? 16 : 12)}
            height={textHeight + (a.background ? 14 : 16)}
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

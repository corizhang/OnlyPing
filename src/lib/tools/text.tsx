import type { ContentTool } from './types'

import { textLayout as textBounds, ANNOTATION_FONT } from './text-layout'

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
    textStyle: style.textStyle ?? { weight: 600, outline: false },
  }),
  hit: (a, x, y) => {
    const bounds = textBounds(a)
    return x >= bounds.x && x <= bounds.x + bounds.w && y >= bounds.y && y <= bounds.y + bounds.h
  },
  draw: (ctx, a) => {
    const { size, lines, lineHeight, style, block, textX } = textBounds(a)
    ctx.save()
    ctx.font = `${style.weight} ${size}px ${ANNOTATION_FONT}`
    ctx.textAlign = style.align
    ctx.textBaseline = 'alphabetic'
    ctx.lineJoin = 'round'
    if (a.background) {
      ctx.fillStyle = style.backgroundColor
      ctx.globalAlpha = style.backgroundOpacity
      ctx.strokeStyle = '#d1d5db'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.roundRect(block.x, block.y, block.w, block.h, style.radius)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'
    ctx.lineWidth = Math.max(4, size / 4)
    lines.forEach((line, index) => {
      const lineY = a.y + index * lineHeight
      if (style.outline) ctx.strokeText(line, textX, lineY)
      ctx.fillStyle = a.color
      ctx.fillText(line, textX, lineY)
    })
    ctx.restore()
  },
  view: (a, { selected, editing }) => {
    const { size, lines, lineHeight, style, block, textX, x, y, w, h } = textBounds(a)
    return (
      <>
        {a.background && <><rect x={block.x} y={block.y} width={block.w} height={block.h} rx={style.radius} fill={style.backgroundColor} fillOpacity={style.backgroundOpacity} /><rect x={block.x} y={block.y} width={block.w} height={block.h} rx={style.radius} fill="none" stroke="#d1d5db" strokeWidth={1} /></>}
        <text visibility={editing ? 'hidden' : undefined} x={textX} y={a.y} textAnchor={style.align === 'center' ? 'middle' : style.align === 'right' ? 'end' : 'start'} fontSize={size} fontWeight={style.weight} fill={a.color} stroke={style.outline ? 'rgba(255,255,255,0.95)' : 'none'} strokeWidth={Math.max(4, size / 4)} paintOrder="stroke" fontFamily={ANNOTATION_FONT}>
          {lines.map((line, index) => <tspan key={index} x={textX} dy={index === 0 ? 0 : lineHeight}>{line}</tspan>)}
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

import type { ContentTool } from './types'
import { calloutLayout, ANNOTATION_FONT } from './text-layout'
import { calloutPath, calloutTail } from './callout-geometry'

export const calloutTool: ContentTool<'callout'> = {
  kind: 'callout',
  create: (id, x, y, style) => ({ id, kind: 'callout', x, y, w: 0, h: 0, text: '', color: style.color, size: style.textSize ?? 18, textStyle: style.textStyle ?? { weight: 600, align: 'left', outline: false, padding: 12, radius: 8, lineHeight: 1.4 } }),
  hit: (a, x, y) => { const layout = calloutLayout(a),tip=calloutTail({...a,...layout}); return (x >= a.x - 6 && x <= a.x + layout.w + 6 && y >= a.y - 8 && y <= a.y + layout.h + 6)||Math.hypot(x-tip.x,y-tip.y)<=8 },
  draw: (ctx, annotation) => {
    const layout = calloutLayout(annotation)
    const a = { ...annotation, w: layout.w, h: layout.h }
    const { style, size, lineHeight, baseline } = layout
    const textX = a.x + (style.align === 'center' ? a.w / 2 : style.align === 'right' ? a.w - style.padding : style.padding)
    ctx.save()
    ctx.fillStyle = style.backgroundColor
    ctx.globalAlpha = style.backgroundOpacity
    ctx.strokeStyle = a.color
    ctx.lineWidth = 2.5
    const path = new Path2D(calloutPath(a))
    ctx.fill(path)
    ctx.globalAlpha = 1
    ctx.stroke(path)
    ctx.fillStyle = style.color ?? a.color
    ctx.font = `${style.weight} ${size}px ${ANNOTATION_FONT}`
    ctx.textAlign = style.align
    ctx.textBaseline = 'alphabetic'
    layout.lines.forEach((line, index) => ctx.fillText(line, textX, a.y + style.padding + baseline + index * lineHeight))
    ctx.restore()
  },
  view: (annotation) => {
    const { lines, w, h, style, size, lineHeight, baseline } = calloutLayout(annotation)
    const a = { ...annotation, w, h }
    const textX = a.x + (style.align === 'center' ? a.w / 2 : style.align === 'right' ? a.w - style.padding : style.padding)
    return (
      <>
        <path d={calloutPath(a)} fill={style.backgroundColor} fillOpacity={style.backgroundOpacity} stroke={a.color} strokeWidth={2.5} />
        <text x={textX} y={a.y + style.padding + baseline} textAnchor={style.align === 'center' ? 'middle' : style.align === 'right' ? 'end' : 'start'} fill={style.color ?? a.color} fontSize={size} fontWeight={style.weight} fontFamily={ANNOTATION_FONT} pointerEvents="none">
          {lines.map((line, index) => <tspan key={index} x={textX} dy={index === 0 ? 0 : lineHeight}>{line}</tspan>)}
        </text>
      </>
    )
  },
}

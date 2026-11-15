import type { CalloutAnnotation } from '@/types'
import type { ContentTool } from './types'
import { calloutLayout, ANNOTATION_FONT } from './text-layout'

const tailSize = (a: CalloutAnnotation) => Math.min(18, Math.max(10, a.w * 0.12))
const CALLOUT_FONT_SIZE = 16
const CALLOUT_LINE_HEIGHT = 20

function calloutPath(a: CalloutAnnotation): string {
  const tail = tailSize(a)
  return `M${a.x + 10} ${a.y} H${a.x + a.w - 10} Q${a.x + a.w} ${a.y} ${a.x + a.w} ${a.y + 10} V${a.y + a.h - 10} Q${a.x + a.w} ${a.y + a.h} ${a.x + a.w - 10} ${a.y + a.h} H${a.x + tail + 16} L${a.x + 8} ${a.y + a.h + tail} L${a.x + 12} ${a.y + a.h} H${a.x + 10} Q${a.x} ${a.y + a.h} ${a.x} ${a.y + a.h - 10} V${a.y + 10} Q${a.x} ${a.y} ${a.x + 10} ${a.y} Z`
}

export const calloutTool: ContentTool<'callout'> = {
  kind: 'callout',
  create: (id, x, y, style) => ({ id, kind: 'callout', x, y, w: 0, h: 0, text: '', color: style.color }),
  hit: (a, x, y) => { const layout = calloutLayout(a); return x >= a.x - 6 && x <= a.x + layout.w + 6 && y >= a.y - 8 && y <= a.y + layout.h + 10 },
  draw: (ctx, annotation) => {
    const layout = calloutLayout(annotation)
    const a = { ...annotation, w: layout.w, h: layout.h }
    const tail = tailSize(a)
    ctx.save()
    ctx.fillStyle = '#fff'
    ctx.strokeStyle = a.color
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(a.x + 12, a.y + a.h - 1)
    ctx.lineTo(a.x + 8, a.y + a.h + tail)
    ctx.lineTo(a.x + tail + 16, a.y + a.h - 1)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.roundRect(a.x, a.y, a.w, a.h, 10)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = a.color
    ctx.font = `600 ${CALLOUT_FONT_SIZE}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    layout.lines.forEach((line, index) => ctx.fillText(line, a.x + a.w / 2, a.y + 10 + index * CALLOUT_LINE_HEIGHT, Math.max(10, a.w - 20)))
    ctx.restore()
  },
  view: (annotation) => {
    const { lines, w, h } = calloutLayout(annotation)
    const a = { ...annotation, w, h }
    return (
      <>
        <path d={calloutPath(a)} fill="#fff" stroke={a.color} strokeWidth={2.5} />
        <text x={a.x + a.w / 2} y={a.y + 10} textAnchor="middle" dominantBaseline="text-before-edge" fill={a.color} fontSize={CALLOUT_FONT_SIZE} fontWeight={600} fontFamily={ANNOTATION_FONT} pointerEvents="none">
          {lines.map((line, index) => <tspan key={index} x={a.x + a.w / 2} dy={index === 0 ? 0 : CALLOUT_LINE_HEIGHT}>{line}</tspan>)}
        </text>
      </>
    )
  },
}

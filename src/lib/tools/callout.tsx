import type { CalloutAnnotation } from '@/types'
import type { ContentTool } from './types'

const tailSize = (a: CalloutAnnotation) => Math.min(18, Math.max(10, a.w * 0.12))
const CALLOUT_FONT_SIZE = 16
const CALLOUT_LINE_HEIGHT = 20

function calloutLines(a: CalloutAnnotation): string[] {
  const charsPerLine = Math.max(1, Math.floor((a.w - 20) / CALLOUT_FONT_SIZE))
  return a.text.split('\n').flatMap(line => {
    const chars = Array.from(line)
    return chars.length > charsPerLine
      ? Array.from({ length: Math.ceil(chars.length / charsPerLine) }, (_, index) => chars.slice(index * charsPerLine, (index + 1) * charsPerLine).join(''))
      : [line]
  }).slice(0, Math.max(1, Math.floor((a.h - 20) / CALLOUT_LINE_HEIGHT)))
}

function calloutPath(a: CalloutAnnotation): string {
  const tail = tailSize(a)
  return `M${a.x + 10} ${a.y} H${a.x + a.w - 10} Q${a.x + a.w} ${a.y} ${a.x + a.w} ${a.y + 10} V${a.y + a.h - 10} Q${a.x + a.w} ${a.y + a.h} ${a.x + a.w - 10} ${a.y + a.h} H${a.x + tail + 16} L${a.x + 8} ${a.y + a.h + tail} L${a.x + 12} ${a.y + a.h} H${a.x + 10} Q${a.x} ${a.y + a.h} ${a.x} ${a.y + a.h - 10} V${a.y + 10} Q${a.x} ${a.y} ${a.x + 10} ${a.y} Z`
}

export const calloutTool: ContentTool<'callout'> = {
  kind: 'callout',
  create: (id, x, y, style) => ({ id, kind: 'callout', x, y, w: 0, h: 0, text: '', color: style.color }),
  hit: (a, x, y) => x >= a.x - 6 && x <= a.x + a.w + 6 && y >= a.y - 8 && y <= a.y + a.h + 10,
  draw: (ctx, a) => {
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
    calloutLines(a).forEach((line, index) => ctx.fillText(line, a.x + a.w / 2, a.y + 10 + index * CALLOUT_LINE_HEIGHT, Math.max(10, a.w - 20)))
    ctx.restore()
  },
  view: (a) => {
    const lines = calloutLines(a)
    return (
      <>
        <path d={calloutPath(a)} fill="#fff" stroke={a.color} strokeWidth={2.5} />
        <text x={a.x + a.w / 2} y={a.y + 10} textAnchor="middle" dominantBaseline="text-before-edge" fill={a.color} fontSize={CALLOUT_FONT_SIZE} fontWeight={600} pointerEvents="none">
          {lines.map((line, index) => <tspan key={index} x={a.x + a.w / 2} dy={index === 0 ? 0 : CALLOUT_LINE_HEIGHT}>{line}</tspan>)}
        </text>
      </>
    )
  },
}

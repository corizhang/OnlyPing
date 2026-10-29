import { ARROW_DEFAULT_WIDTH } from '@/types'
import { distanceToSegment } from './geometry'
import type { MarkTool } from './types'

/** 箭头三角形的顶点，与 Canvas 导出使用相同的尺寸。 */
export function arrowHeadPoints(x1: number, y1: number, x2: number, y2: number, width: number): string {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const length = width * 3.2
  const half = width * 1.7
  const bx = x2 - length * Math.cos(angle)
  const by = y2 - length * Math.sin(angle)
  const nx = -Math.sin(angle)
  const ny = Math.cos(angle)
  return `${x2},${y2} ${bx + half * nx},${by + half * ny} ${bx - half * nx},${by - half * ny}`
}

export const arrowTool: MarkTool<'arrow'> = {
  kind: 'arrow',
  create: (id, x, y, style) => ({ id, kind: 'arrow', x1: x, y1: y, x2: x, y2: y, color: style.color, width: style.strokeWidth }),
  hit: (a, x, y) => distanceToSegment(x, y, a.x1, a.y1, a.x2, a.y2) <= Math.max(10, a.width ?? ARROW_DEFAULT_WIDTH),
  draw: (ctx, a) => {
    const width = a.width ?? ARROW_DEFAULT_WIDTH
    ctx.save()
    ctx.strokeStyle = a.color
    ctx.fillStyle = a.color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(a.x1, a.y1)
    ctx.lineTo(a.x2, a.y2)
    ctx.stroke()
    const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1)
    const length = width * 3.2
    const half = width * 1.7
    const bx = a.x2 - length * Math.cos(angle)
    const by = a.y2 - length * Math.sin(angle)
    const nx = -Math.sin(angle)
    const ny = Math.cos(angle)
    ctx.beginPath()
    ctx.moveTo(a.x2, a.y2)
    ctx.lineTo(bx + half * nx, by + half * ny)
    ctx.lineTo(bx - half * nx, by - half * ny)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  },
  view: (a) => {
    const width = a.width ?? ARROW_DEFAULT_WIDTH
    return (
      <>
        <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke={a.color} strokeWidth={width} strokeLinecap="round" />
        <polygon points={arrowHeadPoints(a.x1, a.y1, a.x2, a.y2, width)} fill={a.color} />
      </>
    )
  },
}

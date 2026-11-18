import type { BoxAnnotation, EllipseAnnotation, ShapeStyle } from '../../types/index.ts'
type Shape = BoxAnnotation | EllipseAnnotation
/** Missing fields describe legacy objects; creation supplies explicit modern defaults. */
export function shapeAppearance(a: Shape) {
  const style = a.style ?? {}
  return { width: style.width ?? 4, strokeStyle: style.strokeStyle ?? 'solid', fill: style.fill ?? (a.kind === 'box' ? 'solid' : 'none'), fillColor: style.fillColor ?? a.color, fillOpacity: style.fillOpacity ?? (a.kind === 'box' ? 34 / 255 : 0.15), radius: a.kind === 'box' ? Math.min(style.radius ?? 0, a.w / 2, a.h / 2) : 0 } as const
}
export function newShapeStyle(style?: ShapeStyle, width = 4): ShapeStyle {
  const number = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
  const strokeStyle = style?.strokeStyle === 'none' || style?.strokeStyle === 'dashed' ? style.strokeStyle : 'solid'
  return { width: number(style?.width, number(width, 4, 1, 16), 1, 16), strokeStyle, fill: style?.fill === 'solid' || strokeStyle === 'none' ? 'solid' : 'none', fillColor: typeof style?.fillColor === 'string' && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/.test(style.fillColor) ? style.fillColor : undefined, fillOpacity: number(style?.fillOpacity, 0.15, 0, 1), radius: number(style?.radius, 0, 0, 40) }
}
/** SVG and Canvas consume this exact same path, including corner radii. */
export function shapePath(a: Shape): string {
  const { x, y, w, h } = a
  if (w <= 0 || h <= 0) return ''
  if (a.kind === 'ellipse') return `M${x} ${y + h / 2} a${w / 2} ${h / 2} 0 1 0 ${w} 0 a${w / 2} ${h / 2} 0 1 0 ${-w} 0 Z`
  const r = shapeAppearance(a).radius
  return `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`
}
export function shapeHit(a: Shape, x: number, y: number): boolean {
  if (a.w <= 0 || a.h <= 0) return false
  const style = shapeAppearance(a), cx = a.x + a.w / 2, cy = a.y + a.h / 2
  let distance: number
  if (a.kind === 'ellipse') {
    const rx = a.w / 2, ry = a.h / 2
    const nx = (x - cx) / rx, ny = (y - cy) / ry, norm = Math.hypot(nx, ny)
    // Distance along the ellipse normal, avoiding the rectangular corner false positives.
    distance = norm === 0 ? -Math.min(rx, ry) : (norm - 1) / Math.hypot(nx / rx / norm, ny / ry / norm)
  } else {
    const qx = Math.abs(x - cx) - (a.w / 2 - style.radius), qy = Math.abs(y - cy) - (a.h / 2 - style.radius)
    distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - style.radius
  }
  if (style.fill === 'solid' && style.fillOpacity > 0 && distance <= 0) return true
  return style.strokeStyle !== 'none' && Math.abs(distance) <= style.width / 2 + 4
}
export function drawShape(ctx: CanvasRenderingContext2D, a: Shape) {
  const d = shapePath(a)
  if (!d) return
  const path = new Path2D(d), style = shapeAppearance(a)
  ctx.save()
  if (style.fill === 'solid') { ctx.globalAlpha = style.fillOpacity; ctx.fillStyle = style.fillColor; ctx.fill(path) }
  ctx.globalAlpha = 1
  if (style.strokeStyle !== 'none') { ctx.strokeStyle = a.color; ctx.lineWidth = style.width; ctx.lineJoin = 'round'; ctx.setLineDash(style.strokeStyle === 'dashed' ? [style.width * 2.5, style.width * 1.5] : []); ctx.stroke(path) }
  ctx.restore()
}

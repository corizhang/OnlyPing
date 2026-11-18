import type { ArrowAnnotation } from '../../types/index.ts'
export const arrowWidth = (a: ArrowAnnotation) => a.width ?? 6
export function arrowControl(a: ArrowAnnotation) {
  if (a.control) return a.control
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1, length = Math.hypot(dx, dy) || 1, bend = Math.min(120, length * .25)
  return { x: (a.x1 + a.x2) / 2 - dy / length * bend, y: (a.y1 + a.y2) / 2 + dx / length * bend }
}
export function arrowCurvePoint(a: ArrowAnnotation, t: number) {
  const c = arrowControl(a), u = 1 - t
  return { x: u * u * a.x1 + 2 * u * t * c.x + t * t * a.x2, y: u * u * a.y1 + 2 * u * t * c.y + t * t * a.y2 }
}
export function controlFromBend(a: ArrowAnnotation, x: number, y: number) { return { x: 2 * x - (a.x1 + a.x2) / 2, y: 2 * y - (a.y1 + a.y2) / 2 } }
function curvedGeometry(a: ArrowAnnotation) {
  const samples = Array.from({ length: 33 }, (_, i) => arrowCurvePoint(a, i / 32))
  const length = samples.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - samples[i].x, p.y - samples[i].y), 0)
  if (length < .01) return { path: '', points: [] as {x:number;y:number}[] }
  const width = Math.min(arrowWidth(a), length / 4), head = Math.min(width * 3.1, length * .4), endT = Math.max(.05, 1 - head / length)
  const c = arrowControl(a), shaft = Array.from({length:33}, (_,i) => { const t = i / 32 * endT, p = arrowCurvePoint(a,t); let dx = 2*((1-t)*(c.x-a.x1)+t*(a.x2-c.x)), dy = 2*((1-t)*(c.y-a.y1)+t*(a.y2-c.y)); const d = Math.hypot(dx,dy); if(d<.001){dx=a.x2-a.x1;dy=a.y2-a.y1}const n=Math.hypot(dx,dy)||1;return {p,nx:-dy/n,ny:dx/n} })
  const base = shaft.at(-1)!.p, direction = Math.hypot(a.x2-base.x,a.y2-base.y)||1, nx=-(a.y2-base.y)/direction, ny=(a.x2-base.x)/direction, half=width*1.55
  const upper=shaft.map(({p,nx,ny})=>({x:p.x+nx*width/2,y:p.y+ny*width/2})), lower=shaft.map(({p,nx,ny})=>({x:p.x-nx*width/2,y:p.y-ny*width/2})).reverse()
  const points=[...upper,{x:base.x+nx*half,y:base.y+ny*half},{x:a.x2,y:a.y2},{x:base.x-nx*half,y:base.y-ny*half},...lower]
  return {path:`M${points.map(p=>`${p.x} ${p.y}`).join(' L')} Z`,points}
}
export function legacyArrowHead(a: ArrowAnnotation): string {
  const angle = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), width = arrowWidth(a)
  const bx = a.x2 - width * 3.2 * Math.cos(angle), by = a.y2 - width * 3.2 * Math.sin(angle)
  const nx = -Math.sin(angle), ny = Math.cos(angle)
  return `${a.x2},${a.y2} ${bx + width * 1.7 * nx},${by + width * 1.7 * ny} ${bx - width * 1.7 * nx},${by - width * 1.7 * ny}`
}
/** One filled contour: the shaft never overshoots the tip, even for short thick arrows. */
export function arrowGeometry(a: ArrowAnnotation) {
  if (a.arrowStyle === 'curved') return curvedGeometry(a)
  const length = Math.hypot(a.x2 - a.x1, a.y2 - a.y1)
  if (length < 0.01) return { path: '', points: [] as { x: number; y: number }[] }
  const ux = (a.x2 - a.x1) / length, uy = (a.y2 - a.y1) / length
  const width = Math.min(arrowWidth(a), length / 4), emphasis = a.arrowStyle === 'emphasis'
  const headLength = Math.min(width * (emphasis ? 4.2 : 3.1), length * 0.46)
  const headHalf = Math.min(width * (emphasis ? 2.1 : 1.55), length * 0.32)
  const neck = width * (emphasis ? 0.68 : 0.5), tail = width * (emphasis ? 0.18 : 0.5), base = length - headLength
  const local = [[0, -tail], [base, -neck], [base, -headHalf], [length, 0], [base, headHalf], [base, neck], [0, tail]]
  const point = (x: number, y: number) => ({ x: a.x1 + ux * x - uy * y, y: a.y1 + uy * x + ux * y })
  const points = local.map(([x,y]) => point(x,y)), cap = point(-tail, 0)
  const path = `M${points.map(p => `${p.x} ${p.y}`).join(' L')} Q${cap.x} ${cap.y} ${points[0].x} ${points[0].y} Z`
  return { path, points }
}
export function pointInArrow(a: ArrowAnnotation, x: number, y: number): boolean {
  const { points } = arrowGeometry(a)
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const p = points[i], q = points[j]
    if ((p.y > y) !== (q.y > y) && x < (q.x - p.x) * (y - p.y) / (q.y - p.y) + p.x) inside = !inside
  }
  return inside
}

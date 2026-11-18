import type { NumberAnnotation } from '../../types/index.ts'
import { measureAnnotationText } from './text-layout.ts'
export function numberLayout(a: NumberAnnotation, label: number) {
  const r = a.r ?? 20, color = a.color ?? '#ef4444', badge = a.badge ?? 'circle'
  const measured = measureAnnotationText(String(label), r, 700)
  const fontSize = Math.min(r, r * 1.45 / Math.max(measured, 1) * r)
  const strokeWidth = badge === 'ring' ? Math.max(2, r * .12) : Math.max(3, r / 6)
  const path = badge === 'square'
    ? `M${a.x-r+r*.22} ${a.y-r} h${2*r-r*.44} q${r*.22} 0 ${r*.22} ${r*.22} v${2*r-r*.44} q0 ${r*.22} ${-r*.22} ${r*.22} h${-2*r+r*.44} q${-r*.22} 0 ${-r*.22} ${-r*.22} v${-2*r+r*.44} q0 ${-r*.22} ${r*.22} ${-r*.22} Z`
    : `M${a.x-r} ${a.y} a${r} ${r} 0 1 0 ${2*r} 0 a${r} ${r} 0 1 0 ${-2*r} 0 Z`
  return { r, badge, color, fontSize, strokeWidth, path, fill: badge === 'ring' ? 'none' : color, stroke: badge === 'ring' ? color : '#ffffff', text: badge === 'ring' ? color : '#ffffff' }
}

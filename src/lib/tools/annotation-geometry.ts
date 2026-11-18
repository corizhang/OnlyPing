import type { Annotation, Rect } from '@/types'
import { arrowGeometry } from './arrow-geometry.ts'
import { calloutTail } from './callout-geometry.ts'
import { calloutLayout } from './text-layout.ts'

/** 所有移动和复制都经过此入口，保持各类坐标的相对位置。 */
export function translateAnnotation<T extends Annotation>(annotation: T, dx: number, dy: number): T {
  if (annotation.kind === 'arrow' || annotation.kind === 'line') return { ...annotation, x1: annotation.x1 + dx, y1: annotation.y1 + dy, x2: annotation.x2 + dx, y2: annotation.y2 + dy, ...(annotation.kind==='arrow'&&annotation.control?{control:{x:annotation.control.x+dx,y:annotation.control.y+dy}}:{}) }
  if (annotation.kind === 'freehand') return { ...annotation, points: annotation.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
  if (annotation.kind === 'callout' && annotation.tail) return { ...annotation,x:annotation.x+dx,y:annotation.y+dy,tail:{x:annotation.tail.x+dx,y:annotation.tail.y+dy} }
  return { ...annotation, x: annotation.x + dx, y: annotation.y + dy }
}

export function duplicateAnnotation<T extends Annotation>(annotation: T, id: string, offset = 16): T {
  return { ...translateAnnotation(annotation, offset, offset), id }
}

export function cropAnnotation(annotation: Annotation, rect: Rect): Annotation | null {
  if (annotation.kind === 'number' || annotation.kind === 'text') {
    const x = annotation.x - rect.x, y = annotation.y - rect.y
    return x < -40 || y < -40 || x > rect.w + 40 || y > rect.h + 40 ? null : translateAnnotation(annotation, -rect.x, -rect.y)
  }
  if (annotation.kind === 'arrow' || annotation.kind === 'line') {
    // 两端均在选区外的线仍可能穿过选区，不能仅按端点过滤。
    const points=annotation.kind==='arrow'&&annotation.arrowStyle==='curved'?arrowGeometry(annotation).points:[{x:annotation.x1,y:annotation.y1},{x:annotation.x2,y:annotation.y2}]
    if(points.length&&(Math.max(...points.map(p=>p.x))<rect.x||Math.min(...points.map(p=>p.x))>rect.x+rect.w||Math.max(...points.map(p=>p.y))<rect.y||Math.min(...points.map(p=>p.y))>rect.y+rect.h))return null
    return translateAnnotation(annotation, -rect.x, -rect.y)
  }
  if (annotation.kind === 'freehand') {
    if (!annotation.points.length) return null
    const bounds = annotation.points.reduce((b, p) => ({ left: Math.min(b.left, p.x), right: Math.max(b.right, p.x), top: Math.min(b.top, p.y), bottom: Math.max(b.bottom, p.y) }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity })
    if (bounds.right < rect.x || bounds.left > rect.x + rect.w || bounds.bottom < rect.y || bounds.top > rect.y + rect.h) return null
    return translateAnnotation(annotation, -rect.x, -rect.y)
  }
  if(annotation.kind==='callout'){const layout=calloutLayout(annotation),tip=calloutTail({...annotation,...layout});if(Math.max(annotation.x+layout.w,tip.x)<rect.x||Math.min(annotation.x,tip.x)>rect.x+rect.w||Math.max(annotation.y+layout.h,tip.y)<rect.y||Math.min(annotation.y,tip.y)>rect.y+rect.h)return null;return translateAnnotation(annotation,-rect.x,-rect.y)}
  const x = Math.max(annotation.x, rect.x), y = Math.max(annotation.y, rect.y)
  const w = Math.min(annotation.x + annotation.w, rect.x + rect.w) - x
  const h = Math.min(annotation.y + annotation.h, rect.y + rect.h) - y
  return w < 8 || h < 8 ? null : { ...annotation, x: x - rect.x, y: y - rect.y, w, h }
}

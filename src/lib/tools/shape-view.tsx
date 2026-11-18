import type { BoxAnnotation, EllipseAnnotation } from '@/types'
import { shapeAppearance, shapePath } from './shape-geometry'

export function renderShape(a: BoxAnnotation | EllipseAnnotation) {
  const style = shapeAppearance(a)
  return <path d={shapePath(a)} fill={style.fill === 'solid' ? style.fillColor : 'none'} fillOpacity={style.fillOpacity}
    stroke={style.strokeStyle === 'none' ? 'none' : a.color} strokeWidth={style.width} strokeLinejoin="round"
    strokeDasharray={style.strokeStyle === 'dashed' ? `${style.width * 2.5} ${style.width * 1.5}` : undefined} />
}

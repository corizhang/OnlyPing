import type { AreaTool } from './types'
import { drawShape, newShapeStyle, shapeHit } from './shape-geometry'
import { renderShape } from './shape-view'

export const boxTool: AreaTool<'box'> = {
  kind: 'box',
  create: (id, x, y, style) => ({ id, kind: 'box', x, y, w: 0, h: 0, color: style.color, style: newShapeStyle(style.shape, style.strokeWidth) }),
  hit: shapeHit,
  draw: drawShape,
  view: renderShape,
}

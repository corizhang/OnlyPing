import type { AreaTool } from './types'
import { drawShape, newShapeStyle, shapeHit } from './shape-geometry'
import { renderShape } from './shape-view'

export const ellipseTool: AreaTool<'ellipse'> = {
  kind: 'ellipse',
  create: (id, x, y, style) => ({ id, kind: 'ellipse', x, y, w: 0, h: 0, color: style.color, style: newShapeStyle(style.shape, style.strokeWidth) }),
  hit: shapeHit,
  draw: drawShape,
  view: renderShape,
}

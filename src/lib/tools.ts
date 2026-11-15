import { createAreaAnnotation, isAreaKind } from './tools/area'
import { createMarkAnnotation, isMarkKind } from './tools/mark'
import { createContentAnnotation } from './tools/content'
import type { Annotation, Tool } from '@/types'
import { uid } from '@/types'
export { DEFAULT_TOOL_ORDER, TOOL_SHORTCUTS } from './tools/catalog'
export type DrawableTool = Exclude<Tool, 'select' | 'text' | 'text-box' | 'crop'>
export function createAnnotation(tool: DrawableTool, x: number, y: number, style: { color: string; numberR: number; mosaicTile: number; strokeWidth: number }): Annotation {
  const id = uid()
  if (isAreaKind(tool)) return createAreaAnnotation(tool, id, x, y, style)
  if (isMarkKind(tool)) return createMarkAnnotation(tool, id, x, y, style)
  switch (tool) {
    case 'magnifier': return createContentAnnotation('magnifier', id, x, y, { color: style.color })
    case 'callout': return createContentAnnotation('callout', id, x, y, { color: style.color })
  }
}

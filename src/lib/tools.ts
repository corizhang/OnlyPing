import { createAreaAnnotation, isAreaKind } from './tools/area'
import { createMarkAnnotation, isMarkKind } from './tools/mark'
import { createContentAnnotation } from './tools/content'
import type { Annotation, Tool } from '@/types'
import { uid } from '@/types'
export const DEFAULT_TOOL_ORDER: Tool[] = ['select', 'box', 'ellipse', 'highlight', 'redact', 'number', 'arrow', 'line', 'freehand', 'callout', 'magnifier', 'mosaic', 'text', 'text-box', 'crop']
export const TOOL_SHORTCUTS: Record<string, Tool> = { v:'select', b:'box', e:'ellipse', h:'highlight', r:'redact', n:'number', a:'arrow', l:'line', p:'freehand', q:'callout', z:'magnifier', m:'mosaic', t:'text', g:'text-box', c:'crop' }
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

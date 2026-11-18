import { DEFAULT_ANNOTATION_STYLE, type AnnotationStyle, type AnnotationTextStyle, type Tool } from '../types/index.ts'
import { DEFAULT_TOOL_ORDER } from './tools/catalog.ts'
import { newShapeStyle } from './tools/shape-geometry.ts'
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const bounded = (value: unknown, fallback: number, min: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
const color = (value: unknown, fallback: string) => typeof value === 'string' && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/.test(value) ? value : fallback
export function normalizeToolStyle(value: unknown, tool: Tool): AnnotationStyle {
  const saved = object(value), text = object(saved.text), callout = tool === 'callout'
  const textStyle: AnnotationTextStyle = {
    color: callout ? color(text.color, '#111827') : undefined,
    weight: text.weight === 400 || text.weight === 700 ? text.weight : 600,
    align: text.align === 'center' || text.align === 'right' ? text.align : 'left',
    lineHeight: bounded(text.lineHeight, 1.4, 1, 3), outline: text.outline === true,
    backgroundColor: color(text.backgroundColor, '#ffffff'), backgroundOpacity: bounded(text.backgroundOpacity, 1, 0, 1), padding: bounded(text.padding, callout ? 12 : 8, 0, 40), radius: bounded(text.radius, callout ? 8 : 6, 0, 40),
  }
  return { ...DEFAULT_ANNOTATION_STYLE, color: color(saved.color, tool === 'highlight' ? '#facc15' : tool === 'text' || tool === 'text-box' ? '#111827' : callout ? '#2563eb' : '#ef4444'), numberR: bounded(saved.numberR, 20, 12, 56), textSize: bounded(saved.textSize, callout ? 18 : 26, 16, 80), mosaicTile: bounded(saved.mosaicTile, 20, 8, 48), strokeWidth: bounded(saved.strokeWidth, 4, 2, 16), shape: newShapeStyle(saved.shape as AnnotationStyle['shape']), arrowStyle: saved.arrowStyle === 'emphasis' || saved.arrowStyle === 'legacy' || saved.arrowStyle === 'curved' ? saved.arrowStyle : 'standard', text: textStyle, numberBadge: saved.numberBadge === 'ring' || saved.numberBadge === 'square' ? saved.numberBadge : 'circle', highlightOpacity: bounded(saved.highlightOpacity, .28, .05, 1), smoothBrush: saved.smoothBrush !== false }
}
export function restoreToolStyles(value: unknown, legacy?: unknown): Record<Tool, AnnotationStyle> {
  const saved = object(value), old = object(legacy)
  return Object.fromEntries(DEFAULT_TOOL_ORDER.map(tool => [tool, normalizeToolStyle(saved[tool] ?? { ...old, ...(tool === 'highlight' ? { color: '#facc15' } : {}), ...(tool === 'callout' ? { textSize: 18 } : {}) }, tool)])) as Record<Tool, AnnotationStyle>
}

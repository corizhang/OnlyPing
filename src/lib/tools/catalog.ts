import type { Tool, Annotation } from '@/types'

export type Interaction = 'select' | 'rectangle' | 'point' | 'endpoints' | 'freehand' | 'text' | 'crop'
export interface ToolDefinition {
  value: Tool
  label: string
  shortcut: string
  interaction: Interaction
  parameter?: 'numberR' | 'textSize' | 'mosaicTile' | 'strokeWidth' | 'zoom'
}

/** 工具栏、快捷键、默认顺序和创建手势共用此定义。 */
export const TOOL_DEFINITIONS = [
  { value: 'select', label: '选择/移动', shortcut: 'V', interaction: 'select' },
  { value: 'box', label: '画框', shortcut: 'B', interaction: 'rectangle' },
  { value: 'ellipse', label: '椭圆', shortcut: 'E', interaction: 'rectangle' },
  { value: 'highlight', label: '高亮', shortcut: 'H', interaction: 'rectangle' },
  { value: 'redact', label: '遮挡', shortcut: 'R', interaction: 'rectangle' },
  { value: 'number', label: '序号', shortcut: 'N', interaction: 'point', parameter: 'numberR' },
  { value: 'arrow', label: '箭头', shortcut: 'A', interaction: 'endpoints', parameter: 'strokeWidth' },
  { value: 'line', label: '直线', shortcut: 'L', interaction: 'endpoints', parameter: 'strokeWidth' },
  { value: 'freehand', label: '自由画笔', shortcut: 'P', interaction: 'freehand', parameter: 'strokeWidth' },
  { value: 'callout', label: '说明气泡', shortcut: 'Q', interaction: 'rectangle', parameter: 'textSize' },
  { value: 'magnifier', label: '局部放大', shortcut: 'Z', interaction: 'rectangle', parameter: 'zoom' },
  { value: 'mosaic', label: '打码', shortcut: 'M', interaction: 'rectangle', parameter: 'mosaicTile' },
  { value: 'text', label: '文字', shortcut: 'T', interaction: 'text', parameter: 'textSize' },
  { value: 'text-box', label: '文字框', shortcut: 'G', interaction: 'text', parameter: 'textSize' },
  { value: 'crop', label: '裁剪', shortcut: 'C', interaction: 'crop' },
] as const satisfies readonly ToolDefinition[]

export const TOOL_CATALOG: Record<Tool, ToolDefinition> = Object.fromEntries(TOOL_DEFINITIONS.map(t => [t.value, t])) as Record<Tool, ToolDefinition>
export const DEFAULT_TOOL_ORDER: Tool[] = TOOL_DEFINITIONS.map(t => t.value)
export const TOOL_SHORTCUTS: Record<string, Tool> = Object.fromEntries(TOOL_DEFINITIONS.map(t => [t.shortcut.toLowerCase(), t.value]))
export function annotationLabel(annotation: Annotation) {
  return TOOL_CATALOG[annotation.kind === 'text' && annotation.background ? 'text-box' : annotation.kind].label
}

export const TOOL_PARAMETERS = {
  numberR: { label: '序号大小', min: 12, max: 56 },
  textSize: { label: '字号', min: 16, max: 80 },
  mosaicTile: { label: '打码强度', min: 8, max: 48 },
  strokeWidth: { label: '线宽', min: 2, max: 16 },
  zoom: { label: '放大倍率', min: 1.5, max: 4 },
} as const

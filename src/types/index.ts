export type Tool = 'select' | 'box' | 'ellipse' | 'highlight' | 'redact' | 'number' | 'arrow' | 'line' | 'freehand' | 'callout' | 'magnifier' | 'mosaic' | 'text' | 'text-box' | 'crop'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface BoxAnnotation extends Rect {
  id: string
  kind: 'box'
  color: string
}

export interface EllipseAnnotation extends Rect {
  id: string
  kind: 'ellipse'
  color: string
}

export interface HighlightAnnotation extends Rect {
  id: string
  kind: 'highlight'
  color: string
}

export interface RedactAnnotation extends Rect {
  id: string
  kind: 'redact'
  color: string
}

export interface MosaicAnnotation extends Rect {
  id: string
  kind: 'mosaic'
  tile?: number // 马赛克块大小（px），越大越模糊，默认 20
}

export interface NumberAnnotation {
  id: string
  kind: 'number'
  x: number
  y: number
  r?: number // 圆半径，默认 20
}

export interface ArrowAnnotation {
  id: string
  kind: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width?: number // 线宽，默认 ARROW_DEFAULT_WIDTH
}

export interface LineAnnotation {
  id: string
  kind: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width?: number
}

export interface FreehandAnnotation {
  id: string
  kind: 'freehand'
  points: { x: number; y: number }[]
  color: string
  width?: number
}

export const ARROW_DEFAULT_WIDTH = 6

export interface TextAnnotation {
  id: string
  kind: 'text'
  x: number
  y: number
  text: string
  color: string
  size?: number // 字号，默认 26
  background?: boolean
}

export interface CalloutAnnotation extends Rect {
  id: string
  kind: 'callout'
  text: string
  color: string
}

export interface MagnifierAnnotation extends Rect {
  id: string
  kind: 'magnifier'
  zoom: number
}

export type Annotation =
  | BoxAnnotation
  | EllipseAnnotation
  | HighlightAnnotation
  | RedactAnnotation
  | MosaicAnnotation
  | NumberAnnotation
  | ArrowAnnotation
  | LineAnnotation
  | FreehandAnnotation
  | TextAnnotation
  | CalloutAnnotation
  | MagnifierAnnotation

export interface Page {
  id: string
  name: string
  image: string // dataURL
  width: number
  height: number
  notes: string // 本页说明文字
  annotations: Annotation[]
  /** 首次裁剪前的原图与标注快照，用于"恢复原图" */
  orig?: { image: string; width: number; height: number; annotations: Annotation[] }
}

export interface AIConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** 导出版式字号设置（px） */
export interface ExportStyle {
  title: number
  heading: number
  notes: number
}

export const DEFAULT_EXPORT_STYLE: ExportStyle = { title: 32, heading: 22, notes: 16 }

/** 导出页脚信息 */
export interface ExportFooter {
  org: string // 编制单位
  version: string // 版本号
  showDate: boolean // 是否显示编制日期
}

export const DEFAULT_EXPORT_FOOTER: ExportFooter = { org: '', version: '', showDate: true }

/** 马赛克默认块大小：20px，足以破坏二维码等图案的可识别性 */
export const MOSAIC_DEFAULT_TILE = 20
export const MOSAIC_MIN_TILE = 8
export const MOSAIC_MAX_TILE = 48

/** 新建标注的默认样式（框/文字颜色、序号半径、文字字号、打码强度） */
export interface AnnotationStyle {
  color: string
  numberR: number
  textSize: number
  mosaicTile: number
}

export const DEFAULT_ANNOTATION_STYLE: AnnotationStyle = {
  color: '#ef4444',
  numberR: 20,
  textSize: 26,
  mosaicTile: MOSAIC_DEFAULT_TILE,
}

/** 标注样式预设（用户级，保存在浏览器本地，可跨项目复用） */
export interface StylePreset extends AnnotationStyle {
  id: string
  name: string
}

export const uid = () => Math.random().toString(36).slice(2, 10)

/** 计算每页序号标注的全局起始值（跨页累计编号） */
export function computeNumberStarts(pages: Page[]): Map<string, number> {
  const map = new Map<string, number>()
  let acc = 0
  for (const p of pages) {
    map.set(p.id, acc)
    acc += p.annotations.filter((a) => a.kind === 'number').length
  }
  return map
}

import type { AnnotationTextStyle } from '../../types/index.ts'
export const ANNOTATION_FONT = '"PingFang SC", "Microsoft YaHei", sans-serif'
let context: CanvasRenderingContext2D | null | undefined

export function measureAnnotationText(text: string, size: number, weight = 700): number {
  if (context === undefined) context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (!context) return Array.from(text).length * size
  context.font = `${weight} ${size}px ${ANNOTATION_FONT}`
  return context.measureText(text).width
}

export function annotationTextAppearance(style?: AnnotationTextStyle, callout = false) {
  return { color: style?.color, weight: style?.weight ?? (callout ? 600 : 700), align: style?.align ?? (callout ? 'center' : 'left'), lineHeight: style?.lineHeight ?? (callout ? 1.25 : 1.3), outline: style?.outline ?? !callout, backgroundColor: style?.backgroundColor ?? '#ffffff', backgroundOpacity: style?.backgroundOpacity ?? 1, padding: style?.padding ?? (callout ? 10 : 6), radius: style?.radius ?? (callout ? 10 : 4) } as const
}
export function baselineOffset(size: number, lineHeight: number, weight: number) {
  measureAnnotationText('Hg国', size, weight)
  const metrics = context?.measureText('Hg国')
  const ascent = metrics?.fontBoundingBoxAscent ?? size * .8, descent = metrics?.fontBoundingBoxDescent ?? size * .2
  return (lineHeight - ascent - descent) / 2 + ascent
}
export function textLayout(a: { x: number; y: number; text: string; size?: number; background?: boolean; textStyle?: AnnotationTextStyle }) {
  const size = a.size ?? 26
  const style = annotationTextAppearance(a.textStyle)
  const lineHeight = Math.round(size * style.lineHeight)
  const lines = a.text.split('\n')
  const textWidth = Math.max(40, size * 0.6, ...lines.map(line => measureAnnotationText(line, size, style.weight)))
  const top = a.y - baselineOffset(size, lineHeight, style.weight), padding = a.background ? style.padding : 0
  const block = { x: a.x - padding, y: top - padding, w: textWidth + padding * 2, h: lines.length * lineHeight + padding * 2 }
  const textX = a.x + (style.align === 'center' ? textWidth / 2 : style.align === 'right' ? textWidth : 0)
  return { size, style, lineHeight, lines, textWidth, textX, top, block,
    x: block.x - 4, y: block.y - 4, w: block.w + 8, h: block.h + 8 }
}

/** 按实际字体宽度折行，保留空行；气泡自动增高，不截断内容。 */
export function calloutLayout(a: { text: string; w: number; h: number; size?: number; textStyle?: AnnotationTextStyle }, measure?: (text: string) => number) {
  const style = annotationTextAppearance(a.textStyle, true), size = a.size ?? 16, lineHeight = Math.round(size * style.lineHeight)
  measure ??= (text: string) => measureAnnotationText(text, size, style.weight)
  const width = Math.max(40, style.padding * 2 + size, a.w)
  const available = width - style.padding * 2
  const lines: string[] = []
  for (const paragraph of a.text.split('\n')) {
    let line = ''
    for (const char of Array.from(paragraph)) {
      if (line && measure(line + char) > available) { lines.push(line); line = '' }
      line += char
    }
    lines.push(line)
  }
  return { lines, size, style, lineHeight, baseline: baselineOffset(size, lineHeight, style.weight), w: width, h: Math.max(a.h, lines.length * lineHeight + style.padding * 2) }
}

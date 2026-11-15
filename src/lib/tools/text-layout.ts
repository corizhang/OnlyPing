export const ANNOTATION_FONT = '"PingFang SC", "Microsoft YaHei", sans-serif'
let context: CanvasRenderingContext2D | null | undefined

export function measureAnnotationText(text: string, size: number, weight = 700): number {
  if (context === undefined) context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  if (!context) return Array.from(text).length * size
  context.font = `${weight} ${size}px ${ANNOTATION_FONT}`
  return context.measureText(text).width
}

export function textLayout(a: { x: number; y: number; text: string; size?: number; background?: boolean }) {
  const size = a.size ?? 26
  const lineHeight = Math.round(size * 1.3)
  const lines = a.text.split('\n')
  const textWidth = Math.max(size * 0.6, ...lines.map(line => measureAnnotationText(line, size)))
  return { size, lineHeight, lines, textWidth,
    x: a.x - (a.background ? 8 : 4), y: a.y - size - 6,
    w: textWidth + (a.background ? 16 : 12), h: lines.length * lineHeight + (a.background ? 14 : 12) }
}

/** 按实际字体宽度折行，保留空行；气泡自动增高，不截断内容。 */
export function calloutLayout(a: { text: string; w: number; h: number }, measure = (text: string) => measureAnnotationText(text, 16, 600)) {
  const width = Math.max(40, a.w)
  const available = width - 20
  const lines: string[] = []
  for (const paragraph of a.text.split('\n')) {
    let line = ''
    for (const char of Array.from(paragraph)) {
      if (line && measure(line + char) > available) { lines.push(line); line = '' }
      line += char
    }
    lines.push(line)
  }
  return { lines, w: width, h: Math.max(a.h, lines.length * 20 + 20) }
}

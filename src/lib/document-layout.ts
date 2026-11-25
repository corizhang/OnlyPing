import type { ExportStyle } from '../types/index.ts'

export const DEFAULT_DOCUMENT_HEADER: NonNullable<ExportStyle['header']> = {
  subtitle: '', background: 'plain', color: '#3c6e9c', textColor: '#192331',
  logoPosition: 'left', logoSize: 48, height: 120, overlay: 0.4, imageFit: 'cover',
}

/** Rows keep source order and original image/annotation identities intact. */
export function documentRows<T>(pages: T[], layout: ExportStyle['layout'] = 'top'): T[][] {
  const columns = layout === 'three' ? 3 : layout === 'two' || layout === 'shared' ? 2 : 1
  const rows: T[][] = []
  for (let index = 0; index < pages.length; index += columns) rows.push(pages.slice(index, index + columns))
  return rows
}

export function stepHeadingParts(index: number, count: number, name: string, style: ExportStyle) {
  const number = count > 1 ? `${index + 1}–${index + count}` : `${index + 1}`
  const kind = style.stepHeading ?? 'text'
  return { kind, number, label: kind === 'circle' ? (count > 1 ? '操作步骤' : name || '操作步骤') : '步骤' }
}

/** A small raster marker keeps circular/badge numerals identical in all exports. */
export function createStepMarker(number: string, style: ExportStyle): HTMLCanvasElement {
  const size = Math.max(28, Math.ceil(style.heading * 1.4))
  const width = style.stepHeading === 'circle' ? Math.max(size, size * (number.length > 3 ? 1.7 : 1)) : Math.max(size, size * number.length * 0.55)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * 2); canvas.height = size * 2
  const ctx = canvas.getContext('2d')!
  ctx.scale(2, 2)
  ctx.fillStyle = style.stepColor ?? '#3c6e9c'
  ctx.beginPath(); ctx.roundRect(0, 0, width, size, style.stepHeading === 'circle' ? size / 2 : 5); ctx.fill()
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = `600 ${Math.min(style.heading, width / Math.max(1, number.length) * 1.3)}px "Microsoft YaHei", sans-serif`
  ctx.fillText(number, width / 2, size / 2)
  return canvas
}

export async function createStepHeading(index: number, count: number, name: string, style: ExportStyle, maxWidth = 744): Promise<HTMLHeadingElement> {
  const parts = stepHeadingParts(index, count, name, style)
  const heading = document.createElement('h2')
  heading.style.cssText = `font-size:${style.heading}px;font-weight:700;line-height:1.5;text-align:${style.headingAlign};margin:0 0 8px;overflow-wrap:anywhere;`
  if (parts.kind === 'text') heading.textContent = `${parts.label} ${parts.number}`
  else {
    const marker = createStepMarker(parts.number, style)
    const canvas = document.createElement('canvas')
    const markerWidth = marker.width / 2, markerHeight = marker.height / 2, gap = 10
    const width = Math.max(markerWidth + gap + style.heading, Math.floor(maxWidth))
    const measure = canvas.getContext('2d')!
    measure.font = `700 ${style.heading}px "Microsoft YaHei", sans-serif`
    const lines: string[] = []
    let line = ''
    for (const char of Array.from(parts.label)) {
      if (line && measure.measureText(line + char).width > width - markerWidth - gap) { lines.push(line); line = '' }
      line += char
    }
    lines.push(line)
    const lineHeight = style.heading * 1.5, firstHeight = Math.max(markerHeight, lineHeight)
    const height = Math.ceil(firstHeight + (lines.length - 1) * lineHeight + 4)
    canvas.width = width * 2; canvas.height = height * 2
    const ctx = canvas.getContext('2d')!
    ctx.scale(2, 2); ctx.font = `700 ${style.heading}px "Microsoft YaHei", sans-serif`
    ctx.fillStyle = '#111827'; ctx.textBaseline = 'middle'
    const labelWidth = Math.max(...lines.map(text => ctx.measureText(text).width))
    const totalWidth = labelWidth + gap + markerWidth
    const left = style.headingAlign === 'center' ? (width - totalWidth) / 2 : style.headingAlign === 'right' ? width - totalWidth : 0
    const textX = parts.kind === 'circle' ? left + markerWidth + gap : left
    ctx.drawImage(marker, parts.kind === 'circle' ? left : left + labelWidth + gap, 2 + (firstHeight - markerHeight) / 2, markerWidth, markerHeight)
    lines.forEach((text, lineIndex) => ctx.fillText(text, textX, 2 + firstHeight / 2 + lineIndex * lineHeight))
    const image = document.createElement('img')
    try { image.src = canvas.toDataURL(); image.width = width; image.height = height } finally { marker.width = 0; marker.height = 0; canvas.width = 0; canvas.height = 0 }
    image.alt = parts.kind === 'circle' ? `${parts.number} ${parts.label}` : `${parts.label} ${parts.number}`
    image.style.cssText = 'display:block;width:100%;height:auto;'
    heading.style.lineHeight = '0'
    heading.appendChild(image)
    await image.decode()
  }
  return heading
}

/** Shared by the preview, PDF, long image and Word cover. */
export async function createDocumentHeader(title: string, style: ExportStyle): Promise<HTMLElement> {
  const options = { ...DEFAULT_DOCUMENT_HEADER, ...style.header }
  const header = document.createElement('header')
  header.style.cssText = `position:relative;box-sizing:border-box;display:flex;align-items:center;min-height:${style.header ? options.height : 0}px;padding:${style.header ? 24 : 4}px;margin:0 0 20px;`
  if (options.background !== 'plain') header.style.backgroundColor = options.color
  if (options.background === 'image' && options.image) {
    const image = new Image()
    image.src = options.image
    await image.decode()
    const background = document.createElement('div')
    background.style.cssText = `position:absolute;inset:0;background-image:url("${options.image}");background-position:center;background-repeat:no-repeat;background-size:${options.imageFit};`
    header.appendChild(background)
    const overlay = document.createElement('div')
    overlay.style.cssText = `position:absolute;inset:0;background:rgba(0,0,0,${options.overlay});`
    header.appendChild(overlay)
  }
  const row = document.createElement('div')
  row.style.cssText = `position:relative;display:flex;width:100%;align-items:center;gap:20px;color:${options.textColor};`
  const text = document.createElement('div')
  text.style.cssText = 'flex:1;min-width:0;'
  const heading = document.createElement('h1')
  heading.textContent = title || '明白纸'
  heading.style.cssText = `font-size:${style.title}px;font-weight:700;line-height:1.5;white-space:pre-wrap;text-align:${style.titleAlign};margin:0;padding:2px 0;overflow-wrap:anywhere;`
  text.appendChild(heading)
  if (options.subtitle) {
    const subtitle = document.createElement('p')
    subtitle.textContent = options.subtitle
    subtitle.style.cssText = `font-size:16px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;text-align:${style.titleAlign};margin:10px 0 0;`
    text.appendChild(subtitle)
  }
  row.appendChild(text)
  if (options.logo) {
    const logo = document.createElement('img')
    logo.src = options.logo
    await logo.decode()
    const scale = options.logoSize / Math.max(logo.naturalWidth, logo.naturalHeight)
    logo.style.cssText = `width:${logo.naturalWidth * scale}px;height:${logo.naturalHeight * scale}px;flex-shrink:0;order:${options.logoPosition === 'left' ? -1 : 1};`
    row.appendChild(logo)
  }
  header.appendChild(row)
  return header
}

import DOMPurify from 'dompurify'
import type { Page } from '@/types'

const TAGS = ['p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'span']

export function notesColor(value: string): string | null {
  const color = value.trim()
  if (/^#[\da-f]{6}$/i.test(color)) return color.toUpperCase()
  if (/^#[\da-f]{3}$/i.test(color)) return `#${[...color.slice(1)].map(c => c + c).join('').toUpperCase()}`
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(color)
  if (!rgb) return null
  const channels = rgb.slice(1).map(Number)
  if (channels.some(channel => channel > 255)) return null
  return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

export function notesFontSize(value: string): number | null {
  const match = /^(\d{2})px$/.exec(value.trim())
  const size = match ? Number(match[1]) : NaN
  return size >= 12 && size <= 40 ? size : null
}

export function notesLineHeight(value: string): number | null {
  const line = Number(value.trim())
  return Number.isFinite(line) && line >= 1 && line <= 2.5 ? line : null
}

export function plainNotesToHtml(value: string): string {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.split(/\r?\n/).map(line => `<p>${line || '<br>'}</p>`).join('')
}

/** Imported project files are user data; only render the formatting our editor supports. */
export function safeNotesHtml(page: Pick<Page, 'notes' | 'notesRich'>): string {
  const sanitized = DOMPurify.sanitize(page.notesRich || plainNotesToHtml(page.notes), {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: ['style'],
  })
  const container = document.createElement('div')
  container.innerHTML = sanitized
  container.querySelectorAll<HTMLElement>('*').forEach(element => {
    const color = element.tagName === 'SPAN' ? notesColor(element.style.color) : null
    const background = element.tagName === 'SPAN' ? notesColor(element.style.backgroundColor) : null
    const size = element.tagName === 'SPAN' ? notesFontSize(element.style.fontSize) : null
    const line = element.tagName === 'P' ? notesLineHeight(element.style.lineHeight) : null
    const align = element.tagName === 'P' && ['left', 'center', 'right'].includes(element.style.textAlign)
      ? element.style.textAlign : null
    element.removeAttribute('style')
    if (color) element.style.color = color
    if (background) element.style.backgroundColor = background
    if (size) element.style.fontSize = `${size}px`
    if (line) element.style.lineHeight = String(line)
    if (align) element.style.textAlign = align
  })
  return container.innerHTML
}

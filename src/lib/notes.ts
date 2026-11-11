import DOMPurify from 'dompurify'
import type { Page } from '@/types'

const TAGS = ['p', 'br', 'strong', 'em', 's', 'ul', 'ol', 'li']

export function plainNotesToHtml(value: string): string {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.split(/\r?\n/).map(line => `<p>${line || '<br>'}</p>`).join('')
}

/** Imported project files are user data; only render the formatting our editor supports. */
export function safeNotesHtml(page: Pick<Page, 'notes' | 'notesRich'>): string {
  return DOMPurify.sanitize(page.notesRich || plainNotesToHtml(page.notes), {
    ALLOWED_TAGS: TAGS,
    ALLOWED_ATTR: [],
  })
}

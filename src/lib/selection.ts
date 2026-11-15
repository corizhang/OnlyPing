import type { Annotation, Page } from '@/types'
import { duplicateAnnotation, translateAnnotation } from './tools/annotation-geometry.ts'

export function toggleSelection(ids: string[], id: string, additive: boolean) {
  return additive ? ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id] : [id]
}
export function editableSelection(annotations: Annotation[], ids: string[]) {
  const selected = new Set(ids)
  return annotations.filter(a => selected.has(a.id) && !a.locked && !a.hidden)
}
export function moveSelection(annotations: Annotation[], ids: string[], dx: number, dy: number) {
  const editable = new Set(editableSelection(annotations, ids).map(a => a.id))
  return annotations.map(a => editable.has(a.id) ? translateAnnotation(a, dx, dy) : a)
}
export function copySelection(annotations: Annotation[], ids: string[], makeId: () => string) {
  return editableSelection(annotations, ids).map(a => duplicateAnnotation(a, makeId()))
}
export type StepFilter = 'all' | 'missing-notes' | 'unannotated'
export function matchesStep(page: Page, query: string, filter: StepFilter) {
  const term = query.trim().toLocaleLowerCase()
  return (!term || `${page.name}\n${page.notes}`.toLocaleLowerCase().includes(term))
    && (filter !== 'missing-notes' || !page.notes.trim())
    && (filter !== 'unannotated' || !page.annotations.some(a => !a.hidden))
}

import { useEffect } from 'react'
import type { Annotation, Page, Tool } from '@/types'
import { uid } from '@/types'
import { duplicateAnnotation, translateAnnotation } from '@/lib/tools/annotation-geometry'

interface SelectionKeyboardProps {
  page: Page; tool: Tool; selectedId: string | null
  onChange: (annotations: Annotation[]) => void
  onSelect: (id: string | null) => void
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void
  onResetCrop: () => void
}
export function useAnnotationKeyboard({ page, tool, selectedId, onChange, onSelect, updateAnnotation, onResetCrop }: SelectionKeyboardProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.defaultPrevented || target.closest('input,textarea,select,[role=slider],[role=separator],[role=tab],[role=menuitem]') || target.isContentEditable) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && tool !== 'crop') {
        onChange(page.annotations.filter((a) => a.id !== selectedId))
        onSelect(null)
      }
      if (e.key === 'Escape') {
        if (tool === 'crop') onResetCrop()
        else onSelect(null)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedId) {
        const ann = page.annotations.find((a) => a.id === selectedId)
        if (ann) {
          e.preventDefault()
          const copy = duplicateAnnotation(ann, uid())
          onChange([...page.annotations, copy])
          onSelect(copy.id)
        }
      }
      if (e.key.startsWith('Arrow') && selectedId) {
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        if (!dx && !dy) return
        e.preventDefault()
        const ann = page.annotations.find((a) => a.id === selectedId)
        if (!ann) return
        updateAnnotation(selectedId, translateAnnotation(ann, dx, dy))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, tool, page.annotations, onResetCrop, onChange, onSelect, updateAnnotation])

}

import { useEffect } from 'react'
import type { Annotation, Page, Tool } from '@/types'
import { uid } from '@/types'
import { copySelection, editableSelection, moveSelection } from '@/lib/selection'

interface SelectionKeyboardProps {
  page: Page; tool: Tool; selectedIds: string[]
  onChange: (annotations: Annotation[]) => void
  onSelectionChange: (ids: string[]) => void
  onResetCrop: () => void
}
export function useAnnotationKeyboard({ page, tool, selectedIds, onChange, onSelectionChange, onResetCrop }: SelectionKeyboardProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.defaultPrevented || target.closest('input,textarea,select,[role=slider],[role=separator],[role=tab],[role=menuitem]') || target.isContentEditable) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && tool !== 'crop') {
        e.preventDefault()
        onSelectionChange(page.annotations.filter(a => !a.locked && !a.hidden).map(a => a.id))
        return
      }
      if (e.key === 'Escape') {
        if (tool === 'crop') onResetCrop()
        else onSelectionChange([])
        return
      }
      if (tool === 'crop') return
      const editable = editableSelection(page.annotations, selectedIds)
      if (!editable.length) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const ids = new Set(editable.map(a => a.id))
        onChange(page.annotations.filter(a => !ids.has(a.id)))
        onSelectionChange(selectedIds.filter(id => !ids.has(id)))
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        const copies = copySelection(page.annotations, selectedIds, uid)
        onChange([...page.annotations, ...copies])
        onSelectionChange(copies.map(a => a.id))
        return
      }
      if (e.key.startsWith('Arrow')) {
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        if (!dx && !dy) return
        e.preventDefault()
        onChange(moveSelection(page.annotations, selectedIds, dx, dy))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds, tool, page.annotations, onResetCrop, onChange, onSelectionChange])
}

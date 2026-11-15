import { memo } from 'react'
import { GripVertical } from 'lucide-react'
import type { Page } from '@/types'

export default memo(function PageListRow({ page, index, selected, sortable, onSelect, onReorder }: {
  page: Page; index: number; selected: boolean; sortable: boolean
  onSelect: (id: string) => void; onReorder: (source: string, target: string) => void
}) {
  return <div role="listitem" draggable={sortable}
    onDragStart={event => { event.dataTransfer.setData('application/x-onlyping-step', page.id); event.dataTransfer.effectAllowed = 'move' }}
    onDragOver={event => { if (sortable && event.dataTransfer.types.includes('application/x-onlyping-step')) event.preventDefault() }}
    onDrop={event => { const source = event.dataTransfer.getData('application/x-onlyping-step'); if (!sortable || !source) return; event.preventDefault(); event.stopPropagation(); onReorder(source, page.id) }}
    className={`group border-b border-white/[0.07] ${selected ? 'bg-[#36577e] text-white' : 'hover:bg-white/[0.06]'}`}>
    <button type="button" onClick={() => onSelect(page.id)}
      className="flex h-[62px] w-full items-center gap-2 px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#77b7ff]"
      aria-current={selected ? 'page' : undefined} title={`${index + 1}. ${page.name || `未命名步骤 ${index + 1}`}`}>
      <span className="w-5 shrink-0 text-center text-xs tabular-nums text-inherit/80">{index + 1}</span>
      <span className="flex h-[48px] w-[40px] shrink-0 items-center justify-center overflow-hidden border border-white/15 bg-white">
        <img draggable={false} loading="lazy" decoding="async" src={page.image} alt="" className="max-h-full max-w-full object-contain" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{page.name || `未命名步骤 ${index + 1}`}</span>
        <span className={`mt-1 block truncate text-[10px] ${selected ? 'text-[#d4e4f5]' : 'text-[#929292]'}`}>{page.notes || `${page.width} × ${page.height} px`}</span>
      </span>
      <GripVertical className={`size-3.5 shrink-0 ${selected ? 'text-white/70' : 'text-[#777] group-hover:text-[#bbb]'}`} aria-hidden="true" />
    </button>
  </div>
})

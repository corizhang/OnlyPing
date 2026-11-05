import { useRef } from 'react'
import { ArrowDown, ArrowUp, Copy, GripVertical, ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Page } from '@/types'

interface Props {
  pages: Page[]
  selectedId: string | null
  onSelect: (id: string) => void
  onImportFiles: (files: Iterable<File>) => Promise<void>
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
  onDuplicate: (id: string) => void
  onReorder: (sourceId: string, targetId: string) => void
}

export default function PageList({ pages, selectedId, onSelect, onImportFiles, onMove, onRemove, onDuplicate, onReorder }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const selectedIndex = pages.findIndex((page) => page.id === selectedId)
  const selectedPage = pages[selectedIndex]

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    await onImportFiles(files)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[#262626] text-[#dedede]" aria-label="步骤图片列表">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <div className="flex items-center gap-2 text-xs font-medium tracking-wide">
          <span>步骤图片</span>
          <span className="rounded-sm bg-[#414141] px-1.5 py-0.5 text-[10px] tabular-nums text-[#c9c9c9]">{pages.length}</span>
        </div>
        <span className="text-[10px] text-[#929292]">拖动排序</span>
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />

      <div className="min-h-0 flex-1 overflow-y-auto py-1" role="list" aria-label="项目步骤">
        {pages.length === 0 && (
          <div className="mx-3 mt-3 border border-dashed border-white/15 px-3 py-7 text-center">
            <ImagePlus className="mx-auto size-5 text-[#979797]" />
            <p className="mt-2 text-xs">尚无步骤图片</p>
            <p className="mt-1 text-[11px] text-[#a5a5a5]">添加截图后即可开始标注</p>
          </div>
        )}
        {pages.map((page, index) => (
          <div
            key={page.id}
            role="listitem"
            draggable
            onDragStart={(event) => { event.dataTransfer.setData('application/x-onlyping-step', page.id); event.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(event) => { if (event.dataTransfer.types.includes('application/x-onlyping-step')) event.preventDefault() }}
            onDrop={(event) => { const source = event.dataTransfer.getData('application/x-onlyping-step'); if (!source) return; event.preventDefault(); event.stopPropagation(); onReorder(source, page.id) }}
            className={`group border-b border-white/[0.07] ${page.id === selectedId ? 'bg-[#36577e] text-white' : 'hover:bg-white/[0.06]'}`}
          >
            <button
              type="button"
              onClick={() => onSelect(page.id)}
              className="flex h-[62px] w-full items-center gap-2 px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#77b7ff]"
              aria-current={page.id === selectedId ? 'page' : undefined}
              title={`${index + 1}. ${page.name || `未命名步骤 ${index + 1}`}`}
            >
              <span className="w-5 shrink-0 text-center text-xs tabular-nums text-inherit/80">{index + 1}</span>
              <span className="flex h-[48px] w-[40px] shrink-0 items-center justify-center overflow-hidden border border-white/15 bg-white">
                <img draggable={false} src={page.image} alt="" className="max-h-full max-w-full object-contain" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{page.name || `未命名步骤 ${index + 1}`}</span>
                <span className={`mt-1 block truncate text-[10px] ${page.id === selectedId ? 'text-[#d4e4f5]' : 'text-[#929292]'}`}>
                  {page.notes || `${page.width} × ${page.height} px`}
                </span>
              </span>
              <GripVertical className={`size-3.5 shrink-0 ${page.id === selectedId ? 'text-white/70' : 'text-[#777] group-hover:text-[#bbb]'}`} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex h-11 shrink-0 items-center justify-between border-t border-white/10 bg-[#202020] px-2">
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-[#d7d7d7] hover:bg-white/10 hover:text-white" onClick={() => fileRef.current?.click()} title="添加截图">
          <ImagePlus className="size-4" />添加
        </Button>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" className="text-[#bcbcbc] hover:bg-white/10 hover:text-white" disabled={selectedIndex <= 0} onClick={() => selectedPage && onMove(selectedPage.id, -1)} title="上移步骤" aria-label="上移步骤"><ArrowUp className="size-4" /></Button>
          <Button variant="ghost" size="icon-sm" className="text-[#bcbcbc] hover:bg-white/10 hover:text-white" disabled={selectedIndex < 0 || selectedIndex === pages.length - 1} onClick={() => selectedPage && onMove(selectedPage.id, 1)} title="下移步骤" aria-label="下移步骤"><ArrowDown className="size-4" /></Button>
          <Button variant="ghost" size="icon-sm" className="text-[#bcbcbc] hover:bg-white/10 hover:text-white" disabled={!selectedPage} onClick={() => selectedPage && onDuplicate(selectedPage.id)} title="复制步骤" aria-label="复制步骤"><Copy className="size-4" /></Button>
          <Button variant="ghost" size="icon-sm" className="text-[#bcbcbc] hover:bg-red-500/15 hover:text-red-300" disabled={!selectedPage} onClick={() => selectedPage && onRemove(selectedPage.id)} title="删除步骤" aria-label="删除步骤"><Trash2 className="size-4" /></Button>
        </div>
      </div>
    </section>
  )
}

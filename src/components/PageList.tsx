import { matchesStep, type StepFilter } from '@/lib/selection'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, ImagePlus, Trash2 } from 'lucide-react'
import PageListRow from './PageListRow'
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
  onExportImage?: (id: string) => void
  exportBusy?: boolean
}

export default function PageList({ pages, selectedId, onSelect, onImportFiles, onMove, onRemove, onDuplicate, onReorder, onExportImage, exportBusy }: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StepFilter>('all')
  const visiblePages = useMemo(() => pages.map((page, index) => ({ page, index })).filter(({ page }) => matchesStep(page, query, filter)), [pages, query, filter])
  const actions = useRef({ onSelect, onReorder, onExportImage })
  useLayoutEffect(() => { actions.current = { onSelect, onReorder, onExportImage } }, [onSelect, onReorder, onExportImage])
  const selectRow = useCallback((id: string) => actions.current.onSelect(id), [])
  const reorderRows = useCallback((source: string, target: string) => actions.current.onReorder(source, target), [])
  const exportRow = useCallback((id: string) => actions.current.onExportImage?.(id), [])
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

      <div className="flex shrink-0 gap-1 border-b border-white/10 px-2 py-2">
        <input type="search" aria-label="搜索步骤" placeholder="搜索名称或说明" value={query} onChange={e => setQuery(e.target.value)} className="h-7 min-w-0 flex-1 rounded-sm border border-white/15 bg-[#303030] px-2 text-xs outline-none focus:border-[#6d9fc7]" />
        <select aria-label="筛选步骤" value={filter} onChange={e => setFilter(e.target.value as StepFilter)} className="h-7 w-20 rounded-sm border border-white/15 bg-[#303030] text-xs"><option value="all">全部</option><option value="missing-notes">缺少说明</option><option value="unannotated">未标注</option></select>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />

      <div className="min-h-0 flex-1 overflow-y-auto py-1" role="list" aria-label="项目步骤">
        {pages.length > 0 && visiblePages.length === 0 && <p className="px-3 py-5 text-xs text-[#aaa]">没有匹配的步骤，请调整搜索或筛选。</p>}
        {pages.length === 0 && (
          <div className="mx-3 mt-3 border border-dashed border-white/15 px-3 py-7 text-center">
            <ImagePlus className="mx-auto size-5 text-[#979797]" />
            <p className="mt-2 text-xs">尚无步骤图片</p>
            <p className="mt-1 text-[11px] text-[#a5a5a5]">添加截图后即可开始标注</p>
          </div>
        )}
        {visiblePages.map(({ page, index }) => <PageListRow key={page.id} page={page} index={index} selected={page.id === selectedId}
          sortable={!query.trim() && filter === 'all'} onSelect={selectRow} onReorder={reorderRows} onExportImage={onExportImage ? exportRow : undefined} exportBusy={exportBusy} />)}
      </div>

      <div className="flex h-11 shrink-0 items-center justify-between border-t border-white/10 bg-[#202020] px-2">
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-[#d7d7d7] hover:bg-white/10 hover:text-white" onClick={() => fileRef.current?.click()} title="添加截图">
          <ImagePlus className="size-4" />添加
        </Button>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" className="text-[#bcbcbc] hover:bg-white/10 hover:text-white" disabled={selectedIndex <= 0 || !!query.trim() || filter !== 'all'} onClick={() => selectedPage && onMove(selectedPage.id, -1)} title="上移步骤" aria-label="上移步骤"><ArrowUp className="size-4" /></Button>
          <Button variant="ghost" size="icon-sm" className="text-[#bcbcbc] hover:bg-white/10 hover:text-white" disabled={selectedIndex < 0 || selectedIndex === pages.length - 1 || !!query.trim() || filter !== 'all'} onClick={() => selectedPage && onMove(selectedPage.id, 1)} title="下移步骤" aria-label="下移步骤"><ArrowDown className="size-4" /></Button>
          <Button variant="ghost" size="icon-sm" className="text-[#bcbcbc] hover:bg-white/10 hover:text-white" disabled={!selectedPage} onClick={() => selectedPage && onDuplicate(selectedPage.id)} title="复制步骤" aria-label="复制步骤"><Copy className="size-4" /></Button>
          <Button variant="ghost" size="icon-sm" className="text-[#bcbcbc] hover:bg-red-500/15 hover:text-red-300" disabled={!selectedPage} onClick={() => selectedPage && onRemove(selectedPage.id)} title="删除步骤" aria-label="删除步骤"><Trash2 className="size-4" /></Button>
        </div>
      </div>
    </section>
  )
}

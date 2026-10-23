import { useRef } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Page } from '@/types'
import { filesToPages } from '@/lib/import'

interface Props {
  pages: Page[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: (pages: Page[]) => void
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
}

export default function PageList({ pages, selectedId, onSelect, onAdd, onMove, onRemove }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const imported = await filesToPages(files)
    if (imported.length) onAdd(imported)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="flex h-full w-60 flex-col border-r bg-white">
      <div className="border-b p-3">
        <Button className="w-full gap-2" onClick={() => fileRef.current?.click()}>
          <ImagePlus className="h-4 w-4" />
          添加截图
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {pages.length === 0 && (
          <p className="mt-8 px-2 text-center text-xs leading-relaxed text-slate-400">
            还没有页面。
            <br />
            点击上方按钮导入截图，
            <br />
            支持多选批量导入。
          </p>
        )}
        {pages.map((page, i) => (
          <div
            key={page.id}
            className={`group cursor-pointer rounded-lg border p-2 transition-colors ${
              page.id === selectedId
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
            onClick={() => onSelect(page.id)}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="truncate text-xs font-medium text-slate-700">
                {i + 1}. {page.name}
              </span>
              <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30"
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMove(page.id, -1)
                  }}
                  title="上移"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30"
                  disabled={i === pages.length - 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    onMove(page.id, 1)
                  }}
                  title="下移"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  className="rounded p-0.5 text-slate-400 hover:bg-red-100 hover:text-red-600"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(page.id)
                  }}
                  title="删除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <img
              src={page.image}
              alt={page.name}
              className="w-full rounded border border-slate-100 object-cover"
              style={{ maxHeight: 120 }}
            />
            {page.notes && (
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-500">{page.notes}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

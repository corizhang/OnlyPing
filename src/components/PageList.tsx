import { useRef } from 'react'
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { Page } from '@/types'

interface Props {
  pages: Page[]
  selectedId: string | null
  onSelect: (id: string) => void
  onImportFiles: (files: Iterable<File>) => Promise<void>
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
}

export default function PageList({ pages, selectedId, onSelect, onImportFiles, onMove, onRemove }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return
    await onImportFiles(files)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r bg-card">
      <div className="space-y-3 border-b px-4 py-3.5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight">页面步骤</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">按顺序整理操作截图</p>
          </div>
          <span className="text-xs tabular-nums text-muted-foreground">{pages.length}</span>
        </div>
        <Button className="w-full justify-center" onClick={() => fileRef.current?.click()}>
          <ImagePlus className="size-4" />
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

      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {pages.length === 0 && (
          <div className="mt-3 border-y border-dashed px-3 py-5 text-center">
            <p className="text-xs font-medium text-foreground">暂无页面</p>
            <p className="mx-auto mt-1.5 max-w-40 text-[11px] leading-relaxed text-muted-foreground">
              添加截图后，在中间画布上标注操作步骤。
            </p>
          </div>
        )}
        {pages.map((page, i) => (
          <article
            key={page.id}
            className={`group overflow-hidden border transition-colors ${
              page.id === selectedId
                ? 'border-primary/60 bg-primary/[0.035]'
                : 'border-border/70 bg-background hover:border-border'
            }`}
          >
            <button
              type="button"
              className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => onSelect(page.id)}
            >
              <div className="relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-muted/60 p-2">
                <img src={page.image} alt={page.name} className="max-h-full max-w-full object-contain" />
                <Badge className="absolute left-2 top-2 h-5 min-w-5 justify-center rounded-sm px-1.5 text-[10px]">
                  {i + 1}
                </Badge>
              </div>
              <div className="px-2.5 pb-1 pt-2">
                <div className="truncate text-xs font-semibold text-foreground">{page.name || `未命名页面 ${i + 1}`}</div>
                {page.notes ? (
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{page.notes}</p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground/75">尚未填写步骤说明</p>
                )}
              </div>
            </button>
            <div className="flex items-center justify-end gap-0.5 border-t border-border/70 px-2 py-1 opacity-70 transition-opacity group-hover:opacity-100">
              <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" disabled={i === 0} onClick={() => onMove(page.id, -1)} title="上移页面" aria-label={`上移第 ${i + 1} 页`}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" disabled={i === pages.length - 1} onClick={() => onMove(page.id, 1)} title="下移页面" aria-label={`下移第 ${i + 1} 页`}>
                <ArrowDown className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => onRemove(page.id)} title="删除页面" aria-label={`删除第 ${i + 1} 页`}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </article>
        ))}
      </div>
    </aside>
  )
}

import { useState } from 'react'
import { Image as ImageIcon } from 'lucide-react'
import type { Page } from '@/types'
import type { ImageExportSelection } from '@/lib/image-export'
import { IMAGE_EXPORT_MAX_PAGES } from '@/lib/image-export'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export default function ImageExportDialog({ pages, currentId, onClose, onExport, busy = false }: {
  pages: Page[]; currentId: string | null; onClose: () => void; onExport: (selection: ImageExportSelection) => void; busy?: boolean
}) {
  const [scope, setScope] = useState<'current' | 'selected' | 'all'>(currentId ? 'current' : 'all')
  const [checked, setChecked] = useState<Set<string>>(() => new Set(currentId ? [currentId] : []))
  const [chunk, setChunk] = useState(0)
  const current = pages.find(page => page.id === currentId)
  const ids = pages.filter(page => checked.has(page.id)).map(page => page.id)
  const count = scope === 'all' ? pages.length : scope === 'current' ? current ? 1 : 0 : ids.length
  const maxChunk = Math.max(0, Math.ceil(pages.length / 20) - 1)
  const actualChunk = Math.min(chunk, maxChunk)
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
      <DialogHeader><DialogTitle>导出标注图片</DialogTitle><DialogDescription>只导出当前裁剪结果和可见标注，不添加标题、步骤说明或页脚。PNG 使用画布尺寸，序号与画布一致。</DialogDescription></DialogHeader>
      <fieldset disabled={busy} className="flex flex-wrap gap-4 text-sm"><legend className="mb-2 text-xs text-muted-foreground">导出范围</legend>
        {([['current', '当前图片'], ['selected', '指定图片'], ['all', `全部图片（${pages.length}）`]] as const).map(([value, label]) => <label key={value} className="flex items-center gap-2"><input type="radio" name="image-export-scope" checked={scope === value} disabled={value === 'current' && !current} onChange={() => setScope(value)} />{label}</label>)}
      </fieldset>
      {scope === 'current' && current && <p className="truncate text-sm">{current.name || '未命名图片'} · {current.width} × {current.height} px</p>}
      {scope === 'selected' && <div className="space-y-2">
        <div className="flex items-center justify-between text-xs"><span>已勾选 {ids.length} / {pages.length} 张</span><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setChecked(new Set(pages.map(page => page.id)))}>勾选全部</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setChecked(new Set())}>清空选择</Button></div></div>
        <div className="max-h-72 overflow-y-auto rounded border" aria-label="选择导出图片">
          {pages.slice(actualChunk * 20, actualChunk * 20 + 20).map((page, index) => <label key={page.id} className="flex cursor-pointer items-center gap-3 border-b p-2 last:border-b-0 hover:bg-muted/50">
            <Checkbox disabled={busy} checked={checked.has(page.id)} aria-label={`导出第 ${actualChunk * 20 + index + 1} 张 ${page.name}`} onCheckedChange={value => setChecked(previous => { const next = new Set(previous); if (value === true) next.add(page.id); else next.delete(page.id); return next })} />
            <span className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">{page.width * page.height <= 4_000_000 ? <img src={page.image} alt="" loading="lazy" decoding="async" className="max-h-full max-w-full object-contain" /> : <ImageIcon className="size-4" />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm">{actualChunk * 20 + index + 1}. {page.name || '未命名图片'}</span><span className="text-xs text-muted-foreground">{page.width} × {page.height} px</span></span>
          </label>)}
        </div>
        {maxChunk > 0 && <div className="flex items-center justify-between text-xs"><Button size="sm" variant="outline" disabled={busy || actualChunk === 0} onClick={() => setChunk(actualChunk - 1)}>上一页</Button><span>{actualChunk + 1} / {maxChunk + 1}</span><Button size="sm" variant="outline" disabled={busy || actualChunk === maxChunk} onClick={() => setChunk(actualChunk + 1)}>下一页</Button></div>}
      </div>}
      <p className="text-xs text-muted-foreground">一张保存 PNG，多张打包 ZIP。文件按项目原顺序编号；“全部”包含列表筛选之外的图片。每批最多 {IMAGE_EXPORT_MAX_PAGES} 张，PNG 合计不超过 200 MiB；大项目请分批导出。</p>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{busy ? '取消导出' : '取消'}</Button><Button disabled={busy || !count || count > IMAGE_EXPORT_MAX_PAGES} onClick={() => onExport(scope === 'all' ? { scope: 'all' } : scope === 'current' ? { scope: 'current', currentId } : { scope: 'selected', ids })}>{busy ? '正在准备…' : `导出 ${count} 张${count > 1 ? '（ZIP）' : '（PNG）'}`}</Button></div>
    </DialogContent>
  </Dialog>
}

import { useMemo, useState } from 'react'
import ImageCompressionPreview from '@/components/ImageCompressionPreview'
import { Image as ImageIcon } from 'lucide-react'
import type { Page } from '@/types'
import type { ImageExportOptions, ImageExportSelection, ImageExportSize } from '@/lib/image-export'
import { imageExportDimensions, IMAGE_EXPORT_MAX_PAGES } from '@/lib/image-export'
import { Input } from '@/components/ui/input'
import { isDesktop } from '@/lib/files'
import { defaultImageExportPreferences, readImageExportPreferences, saveImageExportPreferences } from '@/lib/image-export-preferences'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export default function ImageExportDialog({ pages, currentId, onClose, onExport, busy = false }: {
  pages: Page[]; currentId: string | null; onClose: () => void; onExport: (selection: ImageExportSelection, options: ImageExportOptions) => void; busy?: boolean
}) {
  const [scope, setScope] = useState<'current' | 'selected' | 'all'>(currentId ? 'current' : 'all')
  const [checked, setChecked] = useState<Set<string>>(() => new Set(currentId ? [currentId] : []))
  const [chunk, setChunk] = useState(0)
  const [initial] = useState(() => readImageExportPreferences(isDesktop()))
  const [sizeMode, setSizeMode] = useState<ImageExportSize['mode']>(initial.size.mode)
  const [sizeValue, setSizeValue] = useState(String(initial.size.mode === 'original' ? 50 : initial.size.value))
  const [numbering, setNumbering] = useState<ImageExportOptions['numbering']>(initial.numbering)
  const [destination, setDestination] = useState<'download' | 'folder'>(initial.destination ?? 'download')
  const [format, setFormat] = useState<'png' | 'jpeg'>(initial.format ?? 'png')
  const [quality, setQuality] = useState(String(initial.quality ?? 90))
  const [preferencesError, setPreferencesError] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [sampleId, setSampleId] = useState(currentId ?? pages[0]?.id ?? '')
  const invalidQuality = format === 'jpeg' && (!Number.isInteger(Number(quality)) || Number(quality) < 1 || Number(quality) > 100)
  const formatLabel = format === 'jpeg' ? 'JPEG' : 'PNG'
  const size = useMemo<ImageExportSize>(() => sizeMode === 'original' ? { mode: 'original' } : { mode: sizeMode, value: Number(sizeValue) }, [sizeMode, sizeValue])
  let sizeError = ''
  try { imageExportDimensions(100, 100, size) } catch (error) { sizeError = error instanceof Error ? error.message : '尺寸设置无效' }
  const outputSize = (page: Page) => {
    if (sizeError) return '请填写有效尺寸'
    try { const dimensions = imageExportDimensions(page.width, page.height, size); return `${dimensions.width} × ${dimensions.height} px` } catch { return '图片尺寸无效' }
  }
  const current = pages.find(page => page.id === currentId)
  const ids = pages.filter(page => checked.has(page.id)).map(page => page.id)
  const count = scope === 'all' ? pages.length : scope === 'current' ? current ? 1 : 0 : ids.length
  const maxChunk = Math.max(0, Math.ceil(pages.length / 20) - 1)
  const actualChunk = Math.min(chunk, maxChunk)
  const samples = pages.flatMap((page, index) => scope === 'all' || (scope === 'current' ? page.id === currentId : checked.has(page.id)) ? [{ id: page.id, name: page.name, index }] : [])
  const previewId = samples.some(sample => sample.id === sampleId) ? sampleId : samples[0]?.id
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
      <DialogHeader><DialogTitle>导出标注图片</DialogTitle><DialogDescription>只导出当前裁剪结果和可见标注，不添加标题、步骤说明或页脚。缩放同时作用于图片和标注，不修改原项目。</DialogDescription></DialogHeader>
      <fieldset disabled={busy} className="space-y-3 rounded border p-3 text-sm"><legend className="px-1 text-xs text-muted-foreground">图片设置</legend>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>导出时记住本次设置，不保存图片选择和目录授权。</span><Button variant="ghost" size="sm" onClick={() => { setSizeMode('original'); setSizeValue('50'); setNumbering('project'); setDestination('download'); setFormat('png'); setQuality('90'); setPreferencesError(!saveImageExportPreferences(defaultImageExportPreferences())) }}>恢复默认</Button></div>
        {preferencesError && <p role="status" className="text-xs text-muted-foreground">设置无法写入本机，当前操作仍可继续。</p>}
        <div className="flex flex-wrap items-center gap-2"><label htmlFor="image-export-format">图片格式</label><select id="image-export-format" className="h-9 rounded border bg-background px-2" value={format} onChange={event => setFormat(event.target.value as 'png' | 'jpeg')}><option value="png">PNG · 无损</option><option value="jpeg">JPEG · 有损压缩</option></select>
          {format === 'jpeg' && <label className="flex items-center gap-2">质量<Input aria-label="JPEG 质量" type="number" min={1} max={100} step={1} value={quality} onChange={event => setQuality(event.target.value)} className="w-20" /><span>%</span></label>}
        </div>
        <p className="text-xs text-muted-foreground">PNG 适合文字截图；JPEG 适合照片，质量越低体积通常越小，透明区域填充白色。</p>
        {invalidQuality && <p role="alert" className="text-xs text-destructive">JPEG 质量需为 1–100 的整数</p>}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="image-export-size">图片尺寸</label>
          <select id="image-export-size" value={sizeMode} className="h-9 rounded border bg-background px-2" onChange={event => { const mode = event.target.value as ImageExportSize['mode']; setSizeMode(mode); setSizeValue(mode === 'maxWidth' ? '1920' : '50') }}>
            <option value="original">原始尺寸</option><option value="percent">按比例缩小</option><option value="maxWidth">限制最大宽度</option>
          </select>
          {sizeMode !== 'original' && <label className="flex items-center gap-2"><span className="sr-only">{sizeMode === 'percent' ? '缩放比例' : '最大宽度'}</span><Input type="number" className="w-24" min={1} max={sizeMode === 'percent' ? 100 : 32768} step={sizeMode === 'percent' ? 'any' : 1} value={sizeValue} onChange={event => setSizeValue(event.target.value)} /><span>{sizeMode === 'percent' ? '%' : 'px'}</span></label>}
        </div>
        <label className="flex flex-wrap items-center gap-2">标注序号<select aria-label="标注序号" className="h-9 rounded border bg-background px-2" value={numbering} onChange={event => setNumbering(event.target.value as ImageExportOptions['numbering'])}><option value="project">保留项目连续序号</option><option value="per-image">每张从 1 开始</option></select></label>
        <label className="flex flex-wrap items-center gap-2">保存方式<select aria-label="保存方式" className="h-9 rounded border bg-background px-2" value={destination} onChange={event => setDestination(event.target.value as 'download' | 'folder')}><option value="download">单张 {formatLabel} / 多张 ZIP</option><option value="folder" disabled={!isDesktop()}>独立图片保存到文件夹{!isDesktop() ? '（仅桌面端）' : ''}</option></select></label>
        {destination === 'folder' && <p className="text-xs text-muted-foreground">将在所选位置新建独立子目录，不覆盖已有文件。中途取消或失败会保留已完成的图片，并报告数量和位置。</p>}
        <p className="text-xs text-muted-foreground">仅缩小，不放大小图。文件名仍按项目原顺序编号；尺寸取整，最小为 1 px。</p>
        {sizeError && <p role="alert" className="text-xs text-destructive">{sizeError}</p>}
      </fieldset>
      <fieldset disabled={busy} className="flex flex-wrap gap-4 text-sm"><legend className="mb-2 text-xs text-muted-foreground">导出范围</legend>
        {([['current', '当前图片'], ['selected', '指定图片'], ['all', `全部图片（${pages.length}）`]] as const).map(([value, label]) => <label key={value} className="flex items-center gap-2"><input type="radio" name="image-export-scope" checked={scope === value} disabled={value === 'current' && !current} onChange={() => setScope(value)} />{label}</label>)}
      </fieldset>
      {scope === 'current' && current && <p className="truncate text-sm">{current.name || '未命名图片'} · 导出 {outputSize(current)}</p>}
      {scope === 'selected' && <div className="space-y-2">
        <div className="flex items-center justify-between text-xs"><span>已勾选 {ids.length} / {pages.length} 张</span><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={busy} onClick={() => setChecked(new Set(pages.map(page => page.id)))}>勾选全部</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setChecked(new Set())}>清空选择</Button></div></div>
        <div className="max-h-72 overflow-y-auto rounded border" aria-label="选择导出图片">
          {pages.slice(actualChunk * 20, actualChunk * 20 + 20).map((page, index) => <label key={page.id} className="flex cursor-pointer items-center gap-3 border-b p-2 last:border-b-0 hover:bg-muted/50">
            <Checkbox disabled={busy} checked={checked.has(page.id)} aria-label={`导出第 ${actualChunk * 20 + index + 1} 张 ${page.name}`} onCheckedChange={value => setChecked(previous => { const next = new Set(previous); if (value === true) next.add(page.id); else next.delete(page.id); return next })} />
            <span className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">{page.width * page.height <= 4_000_000 ? <img src={page.image} alt="" loading="lazy" decoding="async" className="max-h-full max-w-full object-contain" /> : <ImageIcon className="size-4" />}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm">{actualChunk * 20 + index + 1}. {page.name || '未命名图片'}</span><span className="text-xs text-muted-foreground">导出 {outputSize(page)}</span></span>
          </label>)}
        </div>
        {maxChunk > 0 && <div className="flex items-center justify-between text-xs"><Button size="sm" variant="outline" disabled={busy || actualChunk === 0} onClick={() => setChunk(actualChunk - 1)}>上一页</Button><span>{actualChunk + 1} / {maxChunk + 1}</span><Button size="sm" variant="outline" disabled={busy || actualChunk === maxChunk} onClick={() => setChunk(actualChunk + 1)}>下一页</Button></div>}
      </div>}
      {format === 'jpeg' && <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={busy || !!sizeError || invalidQuality || !previewId} onClick={() => setPreviewOpen(true)}>预览 JPEG 压缩效果</Button><span className="text-xs text-muted-foreground">比较一张样图的清晰度和实际体积</span></div>}
      <p className="text-xs text-muted-foreground">{destination === 'folder' ? `每张图片保存为独立 ${formatLabel}。` : `一张保存 ${formatLabel}，多张打包 ZIP。`}文件按项目原顺序编号；“全部”包含列表筛选之外的图片。每批最多 {IMAGE_EXPORT_MAX_PAGES} 张，图片合计不超过 200 MiB；大项目请分批导出。</p>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{busy ? '取消导出' : '取消'}</Button><Button disabled={busy || !!sizeError || invalidQuality || !count || count > IMAGE_EXPORT_MAX_PAGES} onClick={() => onExport(scope === 'all' ? { scope: 'all' } : scope === 'current' ? { scope: 'current', currentId } : { scope: 'selected', ids }, { size, numbering, destination, format, quality: format === 'jpeg' ? Number(quality) : 90 })}>{busy ? '正在准备…' : `导出 ${count} 张${destination === 'folder' ? '（文件夹）' : count > 1 ? '（ZIP）' : `（${formatLabel}）`}`}</Button></div>
    </DialogContent>
    {previewOpen && format === 'jpeg' && previewId && <ImageCompressionPreview pages={pages} samples={samples} sampleId={previewId} size={size} numbering={numbering} quality={quality} onQualityChange={setQuality} onSampleChange={setSampleId} onClose={() => setPreviewOpen(false)} />}
  </Dialog>
}

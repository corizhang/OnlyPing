import { canvasBlob, isTaskCancelled, type TaskProgress } from '@/lib/render-task'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ExportFooter, ExportStyle, Page } from '@/types'
import { renderDocument } from '@/lib/exporters'
const LayoutSettings = lazy(() => import('./DocumentLayoutSettings'))

interface Props {
  title: string; pages: Page[]; style: ExportStyle; footer: ExportFooter
  open: boolean; onOpenChange: (open: boolean) => void
  onStyleChange?: (style: ExportStyle) => void
  onFooterChange?: (footer: ExportFooter) => void
}
export default function ExportPreview({ title, pages, style, footer, open, onOpenChange, onStyleChange, onFooterChange }: Props) {
  const [format, setFormat] = useState<'long' | 'pdf'>('long')
  const [images, setImages] = useState<{ url: string; width: number; height: number }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const [progress, setProgress] = useState<TaskProgress | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(true)
  const displayedUrls = useRef(new Set<string>())
  const [generatedCount, setGeneratedCount] = useState(0)
  useEffect(() => {
    const urls = displayedUrls.current
    if (!open) { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); setImages([]) }
    return () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear() }
  }, [open])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    controllerRef.current = controller
    let active = true
    const urls = new Set<string>()
    let committed = false
    setBusy(true); setGeneratedCount(0); setError(''); setProgress(null)
    // Debounce sliders/typing and retain the previous image until the new version is ready.
    const timer = setTimeout(() => { void (async () => {
      if (!active) return
      const nextImages: typeof images = []
      try {
        await renderDocument(title, pages, style, footer, format, style.stepImageScale / 100, {
          signal: controller.signal,
          onProgress: next => { if (active) setProgress(next) },
          onCanvas: async canvas => {
            const blob = await canvasBlob(canvas, { signal: controller.signal })
            if (!active) return
            const url = URL.createObjectURL(blob)
            urls.add(url)
            nextImages.push({ url, width: canvas.width, height: canvas.height })
            setGeneratedCount(nextImages.length)
          },
        })
        if (!active) return
        displayedUrls.current.forEach(url => URL.revokeObjectURL(url))
        displayedUrls.current.clear()
        urls.forEach(url => displayedUrls.current.add(url))
        committed = true
        setImages(nextImages)
      } catch (err) {
        if (active) {
          for (const url of urls) URL.revokeObjectURL(url)
          urls.clear()
          setError(isTaskCancelled(err) ? '已取消预览，可点击重试。' : err instanceof Error ? err.message : '预览失败')
        }
      } finally { if (active) setBusy(false) }
    })() }, 300)
    return () => { active = false; clearTimeout(timer); controller.abort(); if (!committed) urls.forEach(url => URL.revokeObjectURL(url)) }

  }, [open, title, pages, style, footer, format, retry])
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="ps-workspace flex h-[90vh] w-[96vw] flex-col gap-3 overflow-hidden border-white/15 bg-[#282828] text-[#ddd] sm:max-w-[1440px]">
      <DialogHeader><DialogTitle>导出预览</DialogTitle>
        <DialogDescription>与所选格式共用排版和分页。Word 使用可编辑文档排版，分页以 Word 为准。</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2">
        <Button variant={format === 'long' ? 'default' : 'outline'} onClick={() => setFormat('long')}>拼接长图</Button>
        <Button variant={format === 'pdf' ? 'default' : 'outline'} onClick={() => setFormat('pdf')}>PDF · A4</Button>
        <Button variant="outline" aria-label="缩小预览" onClick={() => setZoom(z => Math.max(.25, (z ?? 1) - .25))}>−</Button>
        <Button variant="outline" onClick={() => setZoom(null)}>{zoom === null ? '适应宽度' : `${Math.round(zoom * 100)}% · 适应`}</Button>
        <Button variant="outline" aria-label="放大预览" onClick={() => setZoom(z => Math.min(3, (z ?? 1) + .25))}>+</Button>
        {onStyleChange && <Button variant="outline" className="ml-auto" aria-pressed={settingsOpen} onClick={() => setSettingsOpen(value => !value)}><SlidersHorizontal className="size-4" />版式设置</Button>}
      </div>
      {busy && <div className="flex items-center justify-between gap-2 text-xs" role="status"><span>{progress ? `${progress.phase} ${progress.completed}/${progress.total}` : '正在更新预览…'} · 已生成 {generatedCount} 页{images.length > 0 ? ' · 下方为上次预览' : ''}</span><Button size="sm" variant="outline" onClick={() => controllerRef.current?.abort()}>取消预览</Button></div>}
      <div className="flex min-h-0 flex-1 flex-col gap-4 sm:flex-row">
      <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-[#383838] p-4" aria-label="文档预览内容" aria-busy={busy}>
        {error && <div role="alert">{error}{images.length > 0 && ' 下方保留上次成功的预览。'}<Button onClick={() => setRetry(n => n + 1)}>重试</Button></div>}
        {images.map((page, i) => <figure key={page.url} className="mb-6"><figcaption className="mb-2 text-center text-xs text-muted-foreground">第 {i + 1} {format === 'pdf' ? '页' : '张'}</figcaption><img src={page.url} width={page.width} height={page.height} loading="lazy" decoding="async" alt={`导出预览 ${i + 1}`} className="mx-auto h-auto border" style={{ width: zoom === null ? 840 : 840 * zoom, maxWidth: zoom === null ? '100%' : 'none' }} /></figure>)}

      </div>
      {settingsOpen && onStyleChange && <aside aria-label="预览版式设置" className="max-h-[40vh] w-full shrink-0 overflow-y-auto border-t border-white/10 px-2 pt-3 sm:max-h-none sm:w-80 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
        <div className="mb-3"><h3 className="text-sm font-medium">版式设置</h3><p className="mt-1 text-xs leading-relaxed text-[#999]">修改后自动更新预览，并随当前项目保存。</p></div>
        <Suspense fallback={<p className="text-xs text-[#aaa]">正在加载版式设置…</p>}><LayoutSettings compact style={style} onChange={onStyleChange} footer={footer} onFooterChange={onFooterChange} /></Suspense>
      </aside>}
      </div>
    </DialogContent>
  </Dialog>
}

import { canvasBlob, isTaskCancelled, type TaskProgress } from '@/lib/render-task'
import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { ExportFooter, ExportStyle, Page } from '@/types'
import { renderDocument } from '@/lib/exporters'

interface Props {
  title: string; pages: Page[]; style: ExportStyle; footer: ExportFooter
  open: boolean; onOpenChange: (open: boolean) => void
}
export default function ExportPreview({ title, pages, style, footer, open, onOpenChange }: Props) {
  const [format, setFormat] = useState<'long' | 'pdf'>('long')
  const [images, setImages] = useState<{ url: string; width: number; height: number }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const [progress, setProgress] = useState<TaskProgress | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    controllerRef.current = controller
    let active = true
    const urls = new Set<string>()
    void Promise.resolve().then(async () => {
      if (!active) return
      setImages([]); setBusy(true); setError(''); setProgress(null)
      try {
        await renderDocument(title, pages, style, footer, format, style.stepImageScale / 100, {
          signal: controller.signal,
          onProgress: next => { if (active) setProgress(next) },
          onCanvas: async canvas => {
            const blob = await canvasBlob(canvas, { signal: controller.signal })
            if (!active) return
            const url = URL.createObjectURL(blob)
            urls.add(url)
            setImages(current => [...current, { url, width: canvas.width, height: canvas.height }])
          },
        })
      } catch (err) {
        if (active) {
          for (const url of urls) URL.revokeObjectURL(url)
          urls.clear(); setImages([])
          setError(isTaskCancelled(err) ? '已取消预览，可点击重试。' : err instanceof Error ? err.message : '预览失败')
        }
      } finally { if (active) setBusy(false) }
    })
    return () => { active = false; controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)); setImages([]) }

  }, [open, title, pages, style, footer, format, retry])
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[85vh] w-[95vw] flex-col sm:max-w-[1100px]">
      <DialogHeader><DialogTitle>导出预览</DialogTitle>
        <DialogDescription>与所选格式共用排版和分页。Word 使用可编辑文档排版，分页以 Word 为准。</DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2">
        <Button variant={format === 'long' ? 'default' : 'outline'} onClick={() => setFormat('long')}>拼接长图</Button>
        <Button variant={format === 'pdf' ? 'default' : 'outline'} onClick={() => setFormat('pdf')}>PDF · A4</Button>
        <Button variant="outline" aria-label="缩小预览" onClick={() => setZoom(z => Math.max(.25, (z ?? 1) - .25))}>−</Button>
        <Button variant="outline" onClick={() => setZoom(null)}>{zoom === null ? '适应宽度' : `${Math.round(zoom * 100)}% · 适应`}</Button>
        <Button variant="outline" aria-label="放大预览" onClick={() => setZoom(z => Math.min(3, (z ?? 1) + .25))}>+</Button>
      </div>
      {busy && <div className="flex items-center justify-between gap-2 text-xs" role="status"><span>{progress ? `${progress.phase} ${progress.completed}/${progress.total}` : '正在准备预览…'} · 已生成 {images.length} 页</span><Button size="sm" variant="outline" onClick={() => controllerRef.current?.abort()}>取消预览</Button></div>}
      <div className="min-h-0 flex-1 overflow-auto bg-muted p-4" aria-busy={busy}>
        {error && <div role="alert">{error}<Button onClick={() => setRetry(n => n + 1)}>重试</Button></div>}
        {images.map((page, i) => <figure key={page.url} className="mb-6"><figcaption className="mb-2 text-center text-xs text-muted-foreground">第 {i + 1} {format === 'pdf' ? '页' : '张'}</figcaption><img src={page.url} width={page.width} height={page.height} loading="lazy" decoding="async" alt={`导出预览 ${i + 1}`} className="mx-auto h-auto border" style={{ width: zoom === null ? 840 : 840 * zoom, maxWidth: zoom === null ? '100%' : 'none' }} /></figure>)}

      </div>
    </DialogContent>
  </Dialog>
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ExportFooter, ExportStyle, Page } from '@/types'
import { computeNumberStarts } from '@/types'
import { footerText } from '@/lib/exporters'
import { renderPageToCanvas } from '@/lib/render'

const PREVIEW_WIDTH = 840 // 与长图导出一致的内容宽度
const H_PADDING = 56 // 左右内边距（与导出一致）

interface Props {
  title: string
  pages: Page[]
  style: ExportStyle
  footer: ExportFooter
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** 导出效果预览：与长图/ PDF 导出完全相同的版式，宽度自动适配弹窗 */
export default function ExportPreview({ title, pages, style, footer, open, onOpenChange }: Props) {
  const [images, setImages] = useState<Record<string, string>>({})
  const [rendering, setRendering] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [fitZoom, setFitZoom] = useState(1)
  const [manualZoom, setManualZoom] = useState<number | null>(null)
  const effectiveZoom = manualZoom ?? fitZoom

  // Ctrl+滚轮缩放预览
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !open) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      setManualZoom((z) => Math.min(2.5, Math.max(0.2, (z ?? fitZoom) * (e.deltaY < 0 ? 1.1 : 0.9))))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [open, fitZoom])

  useEffect(() => {
    if (!open || !pages.length) return
    let cancelled = false
    setRendering(true)
    const starts = computeNumberStarts(pages)
    ;(async () => {
      const result: Record<string, string> = {}
      for (const page of pages) {
        const canvas = await renderPageToCanvas(page, starts.get(page.id) ?? 0)
        result[page.id] = canvas.toDataURL('image/png')
      }
      if (!cancelled) {
        setImages(result)
        setRendering(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, pages])

  // 弹窗宽度变化时，自动缩放预览内容以完整显示（不再出现横向滚动条）
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !open) return
    const CONTENT_W = PREVIEW_WIDTH + H_PADDING * 2 + 2
    const measure = () => setFitZoom(Math.min(1, (el.clientWidth - 24) / CONTENT_W))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[95vw] flex-col overflow-hidden sm:max-w-[1400px]">
        <DialogHeader>
          <DialogTitle>导出效果预览</DialogTitle>
          <DialogDescription>
            与「拼接长图 / PDF」导出完全一致的版式：内容宽 {PREVIEW_WIDTH}px，主标题{' '}
            {style.title}px，步骤标题 {style.heading}px，说明文字 {style.notes}
            px（可在顶栏「导出样式」中调整）。预览已按弹窗宽度自动缩放，标注与序号为最终渲染效果。
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-1 border-b pb-2">
          <span className="text-xs text-slate-500">预览缩放：</span>
          <button
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            title="缩小（Ctrl+滚轮）"
            onClick={() => setManualZoom(Math.max(0.2, effectiveZoom / 1.2))}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            className="w-14 rounded px-1 text-center text-xs tabular-nums text-slate-500 hover:bg-slate-100"
            title="点击恢复自动适配"
            onClick={() => setManualZoom(null)}
          >
            {Math.round(effectiveZoom * 100)}%
          </button>
          <button
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            title="放大（Ctrl+滚轮）"
            onClick={() => setManualZoom(Math.min(2.5, effectiveZoom * 1.2))}
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
            onClick={() => setManualZoom(null)}
          >
            适应宽度
          </button>
        </div>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto rounded border bg-slate-100 p-3">
          {rendering ? (
            <div className="flex h-40 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在渲染标注后的图片…
            </div>
          ) : (
            <div style={{ zoom: effectiveZoom }}>
              <div
                className="mx-auto bg-white text-gray-900"
                style={{
                  width: PREVIEW_WIDTH + H_PADDING * 2,
                  padding: `48px ${H_PADDING}px`,
                  fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
                }}
              >
                <h1 style={{ fontSize: style.title, fontWeight: 700, margin: '0 0 16px' }}>
                  {title || '明白纸'}
                </h1>
                {pages.map((page, i) => (
                  <div key={page.id} style={{ marginTop: 40 }}>
                    <h2 style={{ fontSize: style.heading, fontWeight: 700, margin: '0 0 8px' }}>
                      步骤 {i + 1}
                    </h2>
                    {page.notes && (
                      <p style={{ fontSize: style.notes, lineHeight: 1.7, margin: '0 0 12px' }}>
                        {page.notes}
                      </p>
                    )}
                    {images[page.id] ? (
                      <img
                        src={images[page.id]}
                        alt={page.name}
                        style={{
                          width: '100%',
                          border: '1px solid #e5e7eb',
                          borderRadius: 8,
                          display: 'block',
                        }}
                      />
                    ) : (
                      <div className="flex h-24 items-center justify-center text-sm text-slate-400">
                        图片渲染中…
                      </div>
                    )}
                  </div>
                ))}
                {footerText(footer) && (
                  <div
                    style={{
                      marginTop: 40,
                      fontSize: 12,
                      color: '#9ca3af',
                      borderTop: '1px solid #e5e7eb',
                      paddingTop: 12,
                    }}
                  >
                    {footerText(footer)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useMemo, useState } from 'react'
import type { Page } from '@/types'
import { imageExportWarnings, planImageExport, type ImageExportJob, type ImageExportSize } from '@/lib/image-export'
import { renderAnnotatedImagePreview } from '@/lib/exporters'
import { isTaskCancelled } from '@/lib/render-task'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const bytesLabel = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(2)} MiB`
interface Result { job: ImageExportJob; referenceUrl: string; outputUrl: string; referenceBytes: number; outputBytes: number }
export default function ImageCompressionPreview({ pages, samples, sampleId, size, numbering, quality, onQualityChange, onSampleChange, onClose }: {
  pages: Page[]; sampleId: string; size: ImageExportSize; numbering: 'project' | 'per-image'; quality: string
  samples: { id: string; name: string; index: number }[]
  onQualityChange: (value: string) => void; onSampleChange: (id: string) => void; onClose: () => void
}) {
  const options = useMemo(() => ({ size, numbering, format: 'jpeg' as const, quality: Number(quality) }), [size, numbering, quality])
  const plan = useMemo(() => {
    try { return { job: planImageExport(pages, { scope: 'current', currentId: sampleId }, options)[0], error: '' } }
    catch (error) { return { job: null, error: error instanceof Error ? error.message : '无法生成预览' } }
  }, [pages, sampleId, options])
  const [result, setResult] = useState<Result | null>(null)
  const [failure, setFailure] = useState<{ job: ImageExportJob; message: string } | null>(null)
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!plan.job) return
    const job = plan.job, controller = new AbortController(), urls: string[] = []
    let active = true
    const timer = setTimeout(() => {
      void renderAnnotatedImagePreview(job, { signal: controller.signal }).then(output => {
        if (!active) return
        urls.push(URL.createObjectURL(output.reference))
        urls.push(URL.createObjectURL(output.output))
        setResult({ job, referenceUrl: urls[0], outputUrl: urls[1], referenceBytes: output.reference.size, outputBytes: output.output.size })
        setFailure(null)
      }).catch(error => {
        urls.forEach(url => URL.revokeObjectURL(url)); urls.length = 0
        if (active && !isTaskCancelled(error)) setFailure({ job, message: error instanceof Error ? error.message : '预览失败，请重试' })
      })
    }, 350)
    return () => { active = false; clearTimeout(timer); controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [plan.job, retry])
  const current = result?.job === plan.job ? result : null
  const error = plan.error || (failure?.job === plan.job ? failure?.message : '')
  const warnings = plan.job ? imageExportWarnings([plan.job]) : []
  const difference = current ? (1 - current.outputBytes / current.referenceBytes) * 100 : 0
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="flex h-[85vh] w-[95vw] flex-col sm:max-w-5xl">
    <DialogHeader><DialogTitle>JPEG 压缩预览</DialogTitle><DialogDescription>比较同一张标注图片、同一输出尺寸的 PNG 无损参考与 JPEG。仅在本机生成样张，不保存或上传文件。</DialogDescription></DialogHeader>
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex min-w-0 items-center gap-2">样张<select aria-label="预览样张" value={sampleId} onChange={event => onSampleChange(event.target.value)} className="h-9 max-w-64 rounded border bg-background px-2">{samples.map(sample => <option key={sample.id} value={sample.id}>{sample.index + 1}. {sample.name || '未命名图片'}</option>)}</select></label>
      <label className="flex items-center gap-2">质量<Input aria-label="预览 JPEG 质量" className="w-20" type="number" min={1} max={100} step={1} value={quality} onChange={event => onQualityChange(event.target.value)} /><span>%</span></label>
      <Button size="sm" variant={zoom === 'fit' ? 'default' : 'outline'} onClick={() => setZoom('fit')}>适应窗口</Button><Button size="sm" variant={zoom === 'actual' ? 'default' : 'outline'} onClick={() => setZoom('actual')}>100% 像素</Button>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose}>返回导出设置</Button>
    </div>
    {warnings.length > 0 && <p className="text-xs text-amber-600">{warnings[0]}</p>}
    {plan.job && <p className="text-xs text-muted-foreground">样张：第 {plan.job.index + 1} 张 · {plan.job.page.name} · {plan.job.dimensions.width} × {plan.job.dimensions.height} px · {numbering === 'project' ? '保留项目序号' : '每张从 1 开始'}</p>}
    {error ? <div role="alert" className="text-sm text-destructive">{error}<Button variant="ghost" size="sm" onClick={() => { setFailure(null); setRetry(value => value + 1) }}>重试预览</Button></div> : !current ? <p role="status" className="text-sm">正在更新预览…</p> : <p role="status" className="text-sm">PNG {bytesLabel(current.referenceBytes)} → JPEG {bytesLabel(current.outputBytes)} · {difference === 0 ? '体积相同' : difference > 0 ? `减少 ${difference.toFixed(1)}%` : `增大 ${(-difference).toFixed(1)}%`}</p>}
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-3" aria-busy={!error && !current}>
      {(['reference', 'output'] as const).map(kind => <figure key={kind} className="flex min-h-0 min-w-0 flex-col rounded border"><figcaption className="border-b px-3 py-2 text-xs">{kind === 'reference' ? 'PNG · 同尺寸无损参考' : `JPEG · 质量 ${quality}%`}</figcaption><div className="min-h-0 flex-1 overflow-auto bg-white p-2">{current && <img src={kind === 'reference' ? current.referenceUrl : current.outputUrl} width={current.job.dimensions.width} height={current.job.dimensions.height} alt={kind === 'reference' ? 'PNG 无损参考样张' : 'JPEG 压缩样张'} className="mx-auto h-auto" style={{ maxWidth: zoom === 'fit' ? '100%' : 'none', width: zoom === 'fit' ? undefined : current.job.dimensions.width }} />}</div></figure>)}
    </div>
    <p className="text-xs text-muted-foreground">体积是该样张的实际编码结果，不是整个导出包的估算。JPEG 透明区域填白；PNG 参考也使用白底以便比较。调整质量会同步到本次导出设置，确认导出时才记住。</p>
  </DialogContent></Dialog>
}

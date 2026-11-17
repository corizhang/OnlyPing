import { useState } from 'react'
import type { ImageExportReport } from '@/lib/image-export-result'
import { openImageExportLocation } from '@/lib/files'
import { Button } from '@/components/ui/button'
import { FolderOpen, X } from 'lucide-react'

export default function ImageExportResult({ report, onClose }: { report: ImageExportReport; onClose: () => void }) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState('')
  const title = report.status === 'success' ? report.delivery === 'download' ? '已生成图片并发起下载' : '图片导出完成' : report.status === 'cancelled' ? '图片导出已取消' : '图片导出未完成'
  return <section aria-label="图片导出结果" className="fixed bottom-14 right-4 z-30 max-h-[65vh] w-96 max-w-[calc(100vw-2rem)] overflow-auto rounded border bg-background p-4 text-sm shadow-xl">
    <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">{title}</h2><Button size="icon" variant="ghost" aria-label="关闭图片导出结果" onClick={onClose}><X className="size-4" /></Button></div>
    <p className="mt-2">{report.delivery === 'download' ? '已生成' : '已保存'} {report.completed} / {report.total} 张</p>
    {report.delivery === 'download' && <p className="mt-2 text-xs text-muted-foreground">文件已交给浏览器下载，请在浏览器下载记录中确认保存结果。</p>}
    {report.filename && <p className="mt-2 break-all">文件：{report.filename}</p>}
    {(report.path || report.directory) && <p className="mt-2 break-all text-xs text-muted-foreground">位置：{report.path || report.directory}</p>}
    {report.message && <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">{report.message}</p>}
    {report.failedImage && <p className="mt-2 text-destructive">失败图片：第 {report.failedImage.index + 1} 张 · {report.failedImage.name}</p>}
    {report.pending.length > 0 && <details className="mt-3"><summary className="cursor-pointer">未完成 {report.pending.length} 张</summary><ul className="mt-2 max-h-36 space-y-1 overflow-auto text-xs text-muted-foreground">{report.pending.map(page => <li key={page.index} className="break-all">{page.index + 1}. {page.name || '未命名图片'}</li>)}</ul></details>}
    {report.locationId && <Button className="mt-3" variant="outline" disabled={opening} onClick={async () => { setOpening(true); setError(''); try { await openImageExportLocation(report.locationId!) } catch (error) { setError(error instanceof Error ? error.message : '无法打开目录，请手动查看路径') } finally { setOpening(false) } }}><FolderOpen className="mr-2 size-4" />{opening ? '正在打开…' : '打开导出文件夹'}</Button>}
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  </section>
}

import { useEffect, useState } from 'react'
import type { LocalProjectEntry } from '@/lib/db'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export default function ProjectLibrary({ open, onOpenChange, entries, activeKey, onRestore, onDelete, onBackup }: {
  open: boolean; onOpenChange: (open: boolean) => void; entries: LocalProjectEntry[]; activeKey: string
  onRestore: (entry: LocalProjectEntry) => void; onDelete: (entry: LocalProjectEntry) => Promise<void>; onBackup: () => void
}) {
  const [target, setTarget] = useState<LocalProjectEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [capacity, setCapacity] = useState('')
  useEffect(() => {
    if (!open) return
    let active = true
    navigator.storage?.estimate?.().then(({ usage, quota }) => {
      if (active && usage !== undefined && quota) setCapacity(`此网站约占用 ${(usage / 1048576).toFixed(1)} MB / 浏览器配额 ${(quota / 1048576).toFixed(0)} MB`)
    }).catch(() => {})
    return () => { active = false }
  }, [open, entries])
  return <Dialog open={open} onOpenChange={value => { if (!busy) { setTarget(null); setError(''); onOpenChange(value) } }}>
    <DialogContent className="max-h-[80vh] overflow-auto">
      <DialogHeader><DialogTitle>本地项目与历史版本</DialogTitle><DialogDescription>每个项目保留最近 3 个不同版本。删除会同时移除历史版本及不再使用的图片，无法撤销；请先下载备份。当前项目需切换到其他项目后才能删除。</DialogDescription></DialogHeader>
      {capacity && <p className="text-xs text-muted-foreground">{capacity}（估算值，非可用磁盘空间）</p>}
      <Button variant="outline" onClick={onBackup}>下载当前项目备份</Button>
      {target && <div role="alert" className="space-y-3 rounded border border-destructive p-3">
        <p className="text-sm">确认永久删除“{target.title}”及其全部历史版本？</p>
        <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => setTarget(null)}>取消删除</Button><Button variant="destructive" disabled={busy} onClick={async () => {
          setBusy(true); setError('')
          try { await onDelete(target); setTarget(null) } catch (err) { setError(err instanceof Error ? err.message : '删除失败，请重试') } finally { setBusy(false) }
        }}>{busy ? '正在删除…' : '永久删除项目'}</Button></div>
      </div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="space-y-2">{!entries.length && <p>暂无本地项目</p>}{entries.map(entry => <div key={`${entry.key}:${entry.revision ?? 'latest'}`} className="flex items-center gap-2 rounded border p-2">
        <button type="button" disabled={busy} onClick={() => onRestore(entry)} className="min-w-0 flex-1 p-1 text-left hover:bg-muted"><span className="block truncate text-sm">{entry.title}</span><span className="text-xs text-muted-foreground">{entry.pages} 个步骤 · {new Date(entry.savedAt).toLocaleString()} · {entry.revision === undefined ? '打开项目' : '恢复此版本'}</span></button>
        {entry.revision === undefined && <Button variant="ghost" size="sm" disabled={busy || entry.key === activeKey} title={entry.key === activeKey ? '请先切换到其他项目' : '删除项目及历史版本'} onClick={() => { setTarget(entry); setError('') }}>删除</Button>}
      </div>)}</div>
    </DialogContent>
  </Dialog>
}

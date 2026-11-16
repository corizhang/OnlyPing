import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { isDesktop, saveFile, withNativeOperation } from '@/lib/files'
import { readIndexedDBSnapshot, validateAutosave } from '@/lib/db'
import { storageErrorMessage } from '@/lib/storage-errors'
import { isTaskCancelled } from '@/lib/render-task'

export default function StorageRecovery({ open, onOpenChange, error, loading, onRetry, onBackup }: {
  open: boolean; onOpenChange: (open: boolean) => void; error: unknown; loading: boolean
  onRetry: () => void; onBackup: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [location, setLocation] = useState('')
  const run = async (task: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await withNativeOperation(task) }
    catch (error) { if (!isTaskCancelled(error)) setMessage(storageErrorMessage(error)) }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}>
    <DialogContent>
      <DialogHeader><DialogTitle>本地存储与恢复</DialogTitle><DialogDescription>重试不会清空存档。请先备份重要内容，不要删除数据库或清除网站数据。</DialogDescription></DialogHeader>
      <p role={error ? 'alert' : 'status'} className="break-words text-sm">{error ? storageErrorMessage(error) : loading ? '正在读取或迁移本地存档…' : '本地存储已连接。遇到保存失败时，可在这里重试或备份。'}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || loading} onClick={onRetry}>重试连接或保存</Button>
        <Button variant="outline" disabled={busy} onClick={() => void run(onBackup)}>备份当前编辑内容</Button>
        <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
          const snapshot = await readIndexedDBSnapshot()
          const { makeLegacyRecoveryZip } = await import('@/lib/storage-recovery')
          const result = await makeLegacyRecoveryZip(snapshot, validateAutosave, localStorage.getItem('mbz-autosave'))
          await saveFile(result.blob, 'OnlyPing-旧存档恢复包.zip')
          setMessage(`恢复包已保存：${result.count} 条可导入存档，${result.failed} 条失败。详情及原始数据已包含在包内。`)
        })}>导出旧存档恢复包</Button>
      </div>
      <p className="text-xs text-muted-foreground">旧存档包只读导出 IndexedDB，可能是迁移前的内容，不代表当前数据库的最新项目。当前备份仅含已提交到项目状态的文字与标注。</p>
      {isDesktop() && <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
        const { invoke } = await import('@tauri-apps/api/core')
        setLocation(await invoke<string>('project_storage_location'))
        await invoke('project_storage_open_directory')
      })}>查看桌面数据目录</Button>}
      {location && <p className="select-text break-all text-xs">{location}</p>}
      {message && <p role="status" className="break-words text-sm">{message}</p>}
    </DialogContent>
  </Dialog>
}

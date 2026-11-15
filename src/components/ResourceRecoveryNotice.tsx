import { useEffect, useState } from 'react'
import { downloadRecoveryBackup } from '@/lib/crash-recovery'
import { Button } from '@/components/ui/button'
import { isTaskCancelled } from '@/lib/render-task'

export default function ResourceRecoveryNotice() {
  const [visible, setVisible] = useState(false)
  const [backupError, setBackupError] = useState('')
  useEffect(() => {
    const failed = () => { setVisible(true); setBackupError('') }
    // Keep the error rejection intact: individual feature callers must still
    // stop their task and render a retry state. Never automatically reload.
    window.addEventListener('vite:preloadError', failed)
    return () => window.removeEventListener('vite:preloadError', failed)
  }, [])
  if (!visible) return null
  return <section role="alert" aria-label="功能资源加载失败" className="fixed bottom-4 left-16 z-[100] w-[min(600px,calc(100vw-96px))] space-y-3 rounded border border-amber-600/60 bg-[#292929] p-4 text-sm text-neutral-100 shadow-xl">
    <p className="font-medium">部分功能资源加载失败</p>
    <p className="text-xs leading-relaxed text-neutral-300">可能网络暂时中断，或页面版本已更新。当前编辑区保留，可先重试。仍失败时，请结束文字编辑并下载备份，再重新加载。</p>
    <p className="text-xs text-neutral-400">备份包含已同步到项目的内容；未结束的输入可能不包含。重新加载会读取最近成功保存的本地存档。</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={async () => {
        try { if (!await downloadRecoveryBackup()) setBackupError('暂无可备份的项目，请保留页面并重试') }
        catch (error) { if (!isTaskCancelled(error)) setBackupError('备份下载失败，请保留页面并检查保存位置') }
      }}>下载已同步备份</Button>
      <Button size="sm" variant="outline" onClick={() => window.location.reload()}>重新加载页面</Button>
      <Button size="sm" variant="ghost" onClick={() => setVisible(false)}>继续编辑</Button>
    </div>
    {backupError && <p className="text-xs text-amber-300">{backupError}</p>}
  </section>
}

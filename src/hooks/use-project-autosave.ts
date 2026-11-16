import { useEffect, useRef, useState } from 'react'
import { idbSet, type ProjectData } from '@/lib/db'
import { storageErrorMessage } from '@/lib/storage-errors'

export function useProjectAutosave(data: ProjectData, ready: boolean, pendingText = false) {
  const [status, setStatus] = useState('')
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState<unknown>(null)
  const saved = useRef<ProjectData | null>(null)
  const dirty = useRef(false)
  // Loading/storage failures must not disable the warning for newly edited content.
  useEffect(() => {
    dirty.current = pendingText || saved.current !== data
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [data, pendingText])
  useEffect(() => {
    if (!ready) return
    let active = true
    let inFlight = false
    dirty.current = pendingText || saved.current !== data
    // 保存状态是异步存储任务的生命周期反馈。
    setStatus(dirty.current ? '有未保存的修改…' : '已保存到本机')
    const save = async () => {
      if (inFlight || saved.current === data) return
      inFlight = true
      if (active) setStatus('正在保存…')
      try {
        await idbSet({ ...data, savedAt: Date.now() })
        if (active) {
          saved.current = data
          dirty.current = pendingText
          setStatus(`已保存 ${new Date().toLocaleTimeString()}`)
          setError(null)
          // Keep legacy source for recovery, including damaged or not-yet-migrated data.
        }
      } catch (err) {
        if (active) { setStatus(`保存失败：${storageErrorMessage(err)}`); setError(err) }
      } finally { inFlight = false }
    }
    const timer = setTimeout(save, 1000)
    const onVisibility = () => { if (document.visibilityState === 'hidden') void save() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [data, ready, retry, pendingText])
  return { error, status: pendingText ? '正在编辑文字，结束后保存' : status, retry: () => setRetry(n => n + 1) }
}

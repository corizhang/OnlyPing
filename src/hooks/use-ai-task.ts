import { useEffect, useRef, useState } from 'react'
import { isTaskCancelled } from '@/lib/render-task'

export function useAITask(projectId: string) {
  const controller = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<{ kind: 'info' | 'ok' | 'err'; text: string } | null>(null)
  useEffect(() => () => {
    const active = controller.current
    controller.current = null
    active?.abort()
  }, [projectId])
  const run = async (key: string, work: (signal: AbortSignal) => Promise<string>) => {
    if (controller.current) return
    const current = new AbortController()
    controller.current = current
    setBusy(key); setStatus(null)
    try {
      const text = await work(current.signal)
      current.signal.throwIfAborted()
      setStatus({ kind: 'ok', text })
    } catch (err) {
      if (controller.current !== current) return
      setStatus(isTaskCancelled(err) ? { kind: 'info', text: '已取消，已完成的页面保留，可重新执行或重试未完成页。' } : { kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      if (controller.current === current) { controller.current = null; setBusy(null) }
    }
  }
  return { busy, status, setStatus, run, cancel: () => controller.current?.abort() }
}

import { useEffect, useRef, useState } from 'react'
import { checkTask, type RenderTask, type TaskProgress } from '@/lib/render-task'

export function useExportTask(projectId: string) {
  const controller = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<TaskProgress | null>(null)
  useEffect(() => () => controller.current?.abort(), [projectId])
  const cancel = () => controller.current?.abort()
  const run = async (work: (task: RenderTask) => Promise<void>) => {
    if (controller.current) return
    const current = new AbortController()
    controller.current = current
    setBusy(true); setProgress(null)
    try {
      await work({ signal: current.signal, onProgress: next => { if (!current.signal.aborted) setProgress(next) } })
      checkTask({ signal: current.signal })
    } finally {
      if (controller.current === current) { controller.current = null; setBusy(false); setProgress(null) }
    }
  }
  return { busy, progress, run, cancel }
}

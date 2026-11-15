import { isTaskCancelled } from './render-task.ts'

/** 失败页继续收集；取消时只保留失败和未完成页，已应用结果不重复执行。 */
export async function runAIBatch<T>({ targets, signal, process, onProgress, onInterrupted }: {
  targets: T[]; signal: AbortSignal
  process: (target: T, index: number) => Promise<void>
  onProgress: (target: T, index: number) => void
  onInterrupted: (remaining: T[]) => void
}): Promise<T[]> {
  const failed: T[] = []
  for (let index = 0; index < targets.length; index++) {
    try {
      signal.throwIfAborted()
      onProgress(targets[index], index)
      await process(targets[index], index)
    } catch (err) {
      if (signal.aborted || isTaskCancelled(err)) {
        onInterrupted([...failed, ...targets.slice(index)])
        throw signal.reason ?? err
      }
      failed.push(targets[index])
    }
  }
  return failed
}

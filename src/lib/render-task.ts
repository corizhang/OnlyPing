export interface TaskProgress { phase: string; completed: number; total: number }
export interface RenderTask {
  signal?: AbortSignal
  onProgress?: (progress: TaskProgress) => void
  onCanvas?: (canvas: HTMLCanvasElement, index: number) => Promise<void>
}
export const isTaskCancelled = (error: unknown) => error instanceof Error && error.name === 'AbortError'
export function checkTask(task: RenderTask = {}) { task.signal?.throwIfAborted() }
export function cancellableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
export async function taskCheckpoint(task: RenderTask, phase: string, completed: number, total: number) {
  checkTask(task)
  task.onProgress?.({ phase, completed, total })
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  checkTask(task)
}
export function releaseCanvas(canvas: HTMLCanvasElement) { canvas.width = 0; canvas.height = 0 }
export async function canvasBlob(canvas: HTMLCanvasElement, task: RenderTask = {}): Promise<Blob> {
  checkTask(task)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片编码失败'))))
  checkTask(task)
  return blob
}

/** 取消的排队任务不会启动；正在处理的旧任务清理后，新任务才开始。 */
export class RenderQueue {
  private tail: Promise<unknown> = Promise.resolve()
  run<T>(task: RenderTask, work: () => Promise<T>): Promise<T> {
    const next = this.tail.catch(() => undefined).then(() => { checkTask(task); return work() })
    this.tail = next.then(() => undefined, () => undefined)
    return next
  }
}

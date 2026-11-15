/** Coordinates IME completion before switching a document or persisting it.
 * ProseMirror defers its composition-end DOM flush; wait beyond that turn.
 */
export class InputSettlement {
  private pending: Promise<boolean> | null = null
  private resolve: ((ready: boolean) => void) | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private flushers = new Set<() => void>()
  private disposed = false
  private intent = 0
  private onPending: (pending: boolean) => void
  constructor(onPending: (pending: boolean) => void = () => {}) { this.onPending = onPending }
  activate() { this.disposed = false }
  get awaitingComposition() { return this.pending !== null }
  begin() {
    if (this.disposed) return
    clearTimeout(this.timer)
    if (!this.pending) this.pending = new Promise(resolve => { this.resolve = resolve })
    this.onPending(true)
  }
  end() {
    if (!this.pending) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      const resolve = this.resolve
      this.pending = null; this.resolve = null
      this.onPending(false)
      resolve?.(true)
    }, 50)
  }
  register(flush: () => void) { this.flushers.add(flush); return () => { this.flushers.delete(flush) } }
  invalidate() { this.intent++ }
  async settle(blur: () => void = () => {}): Promise<boolean> {
    if (this.disposed) return false
    blur()
    if (this.pending) {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const ready = await Promise.race([this.pending, new Promise<boolean>(resolve => { timeout = setTimeout(() => resolve(false), 1500) })])
      clearTimeout(timeout)
      if (!ready || this.disposed) return false
    }
    for (const flush of this.flushers) flush()
    return !this.disposed
  }
  async transition(action: () => void, blur: () => void, blocked: () => void) {
    const intent = ++this.intent
    const ready = await this.settle(blur)
    if (intent !== this.intent || this.disposed) return
    if (ready) action()
    else blocked()
  }
  dispose() {
    this.disposed = true; this.invalidate(); clearTimeout(this.timer)
    this.resolve?.(false); this.resolve = null; this.pending = null; this.flushers.clear()
  }
}

export function isComposingKey(event: { isComposing?: boolean; keyCode?: number }) {
  return event.isComposing === true || event.keyCode === 229
}

/** Dev diagnostics only, enabled by the isolated performance test page. */
export function reportEditorPhase(phase: string, milliseconds: number) {
  if (!import.meta.env?.DEV || typeof document === 'undefined' || !document.documentElement.getAttribute('data-onlyping-performance')) return
  document.dispatchEvent(new CustomEvent('onlyping:performance', { detail: { phase, milliseconds } }))
}

export function startEditorPhase(phase: string): () => void {
  if (!import.meta.env?.DEV || typeof document === 'undefined') return () => {}
  const epoch = document.documentElement.getAttribute('data-onlyping-performance')
  if (!epoch) return () => {}
  const start = performance.now()
  let finished = false
  return () => {
    if (!finished && document.documentElement.getAttribute('data-onlyping-performance') === epoch) reportEditorPhase(phase, performance.now() - start)
    finished = true
  }
}

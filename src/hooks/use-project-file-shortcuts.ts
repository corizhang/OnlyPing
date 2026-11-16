import { useEffect, useLayoutEffect, useRef } from 'react'
import { isComposingKey } from '../lib/input-settlement.ts'

/** Window capture also works before an editor/input has received focus. */
export function useProjectFileShortcuts(save: (saveAs: boolean) => Promise<void>, open: () => Promise<void>) {
  const actions = useRef({ save, open })
  useLayoutEffect(() => { actions.current = { save, open } }, [save, open])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || isComposingKey(event)) return
      const key = event.key.toLowerCase()
      if (key !== 's' && !(key === 'o' && !event.shiftKey)) return
      event.preventDefault()
      if (event.repeat) return
      if (key === 's') void actions.current.save(event.shiftKey)
      else void actions.current.open()
    }
    window.addEventListener('keydown', keydown, true)
    return () => window.removeEventListener('keydown', keydown, true)
  }, [])
}

import { useEffect, useLayoutEffect, useRef } from 'react'
import { isDesktop } from '@/lib/files'

export function useDesktopClose(beforeClose: () => Promise<boolean>, onError: () => void) {
  const callbacks = useRef({ beforeClose, onError })
  useLayoutEffect(() => { callbacks.current = { beforeClose, onError } }, [beforeClose, onError])
  useEffect(() => {
    if (!isDesktop()) return
    let active = true, closing = false
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow()
      const stop = await window.onCloseRequested(async event => {
        event.preventDefault()
        if (!active || closing) return
        closing = true
        try { if (await callbacks.current.beforeClose() && active) await window.destroy() }
        catch { callbacks.current.onError() }
        finally { closing = false }
      })
      if (!active) stop(); else unlisten = stop
    }).catch(() => { if (active) callbacks.current.onError() })
    return () => { active = false; unlisten?.() }
  }, [])
}

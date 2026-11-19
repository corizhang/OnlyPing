import { useEffect, useLayoutEffect, useRef } from 'react'
import { isDesktop } from '@/lib/files'
import type { CloseChoice } from '@/lib/desktop-lifecycle'

export interface DesktopCloseCallbacks {
  beforeClose: () => Promise<boolean>
  onError: () => void
  beforeHide: () => Promise<boolean>
  choose: (trayAvailable: boolean) => Promise<CloseChoice | null>
  settings: (updates?: boolean) => void
  beforeUpdate?: () => Promise<boolean>
}
export function useDesktopClose(beforeClose: () => Promise<boolean>, onError: () => void, options: {
  beforeHide: () => Promise<boolean>
  choose: (trayAvailable: boolean) => Promise<CloseChoice | null>
  settings: (updates?: boolean) => void
  beforeUpdate?: () => Promise<boolean>
}) {
  const callbacks = useRef({ beforeClose, onError, ...options })
  useLayoutEffect(() => { callbacks.current = { beforeClose, onError, ...options } })
  useEffect(() => {
    if (!isDesktop()) return
    let active = true
    const stops: (() => void)[] = []
    void import('@/lib/desktop-events').then(({ listenDesktopEvents }) => listenDesktopEvents(() => callbacks.current, () => active, stop => stops.push(stop))).catch(() => { if (active) callbacks.current.onError() })
    return () => { active = false; stops.forEach(stop => stop()) }
  }, [])
}

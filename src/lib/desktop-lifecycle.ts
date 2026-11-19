export type CloseBehavior = 'ask' | 'tray' | 'exit'
export interface DesktopPreferences { closeBehavior: CloseBehavior; minimizeToTray: boolean; rememberWindow: boolean; autoCheckUpdates: boolean }
export interface DesktopInfo { preferences: DesktopPreferences; trayAvailable: boolean }
export interface CloseChoice { behavior: 'tray' | 'exit'; remember: boolean }
interface Host {
  read(): Promise<DesktopInfo>
  save(preferences: DesktopPreferences): Promise<unknown>
  choose(trayAvailable: boolean): Promise<CloseChoice | null>
  beforeExit(): Promise<boolean>
  beforeHide(): Promise<boolean>
  action(action: 'hide' | 'exit' | 'restore'): Promise<unknown>
  error(error: unknown): void
}
/** Serialize close, minimize and tray-exit requests through the same guards. */
export function createDesktopLifecycle(host: Host) {
  let busy = false
  return async (reason: 'close' | 'exit' | 'minimize') => {
    if (busy) return
    busy = true
    try {
      const info = await host.read()
      if (reason === 'minimize' && (!info.trayAvailable || !info.preferences.minimizeToTray)) return
      let behavior: CloseBehavior = reason === 'exit' ? 'exit' : reason === 'minimize' ? 'tray' : info.preferences.closeBehavior
      if (behavior === 'ask') {
        const choice = await host.choose(info.trayAvailable)
        if (!choice) return
        behavior = choice.behavior
        if (choice.remember) await host.save({ ...info.preferences, closeBehavior: behavior })
      }
      if (behavior === 'tray' && info.trayAvailable) {
        if (await host.beforeHide()) await host.action('hide')
        else await host.action('restore')
      } else if (await host.beforeExit()) await host.action('exit')
    } catch (error) {
      try { await host.action('restore') } catch { /* Keep the original failure. */ }
      host.error(error)
    } finally { busy = false }
  }
}

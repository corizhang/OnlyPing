import { appUpdates, attachUpdates } from './desktop-updates'
import { toast } from 'sonner'
import { createDesktopLifecycle, type DesktopInfo } from './desktop-lifecycle'
import type { DesktopCloseCallbacks } from '@/hooks/use-desktop-close'
export async function listenDesktopEvents(callbacks: () => DesktopCloseCallbacks, active: () => boolean, register: (stop: () => void) => void) {
  const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')])
  const request = createDesktopLifecycle({
    read: () => invoke<DesktopInfo>('desktop_preferences'),
    save: preferences => invoke('desktop_save_preferences', { preferences }),
    choose: available => callbacks().choose(available),
    beforeExit: () => active() ? callbacks().beforeClose() : Promise.resolve(false),
    beforeHide: () => active() ? callbacks().beforeHide() : Promise.resolve(false),
    action: action => active() ? invoke('desktop_close_action', { action }) : Promise.resolve(),
    error: () => { if (active()) callbacks().onError() },
  })
  void attachUpdates({ beforeInstall: () => callbacks().beforeUpdate?.() ?? callbacks().beforeClose(), settings: () => callbacks().settings(true) }, active, stop => { if (active()) register(stop); else stop() })
  const results = await Promise.allSettled([
    listen<string>('onlyping-close', event => { if (active() && ['close', 'exit', 'minimize'].includes(event.payload)) { if (appUpdates.isInstalling()) toast.info('正在准备或安装更新，请稍候'); else void request(event.payload as 'close' | 'exit' | 'minimize') } }),
    listen('onlyping-settings', () => { if (active()) callbacks().settings() }),
  ])
  for (const result of results) {
    if (result.status === 'fulfilled') { if (active()) register(result.value); else result.value() }
    else if (active()) callbacks().onError()
  }
}

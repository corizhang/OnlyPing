import { invoke, Channel } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { createUpdateController, type UpdateInfo, type UpdateRelease, type UpdateProgress } from './update-controller'
import { withNativeOperation } from './files'
import type { DesktopInfo } from './desktop-lifecycle'

let prepare: (() => Promise<boolean>) | null = null
let openSettings: (() => void) | null = null
export const appUpdates = createUpdateController({
  info: () => invoke<UpdateInfo>('app_update_info'),
  check: () => invoke<UpdateRelease | null>('app_update_check'),
  download: async progress => { const channel = new Channel<UpdateProgress>(); channel.onmessage = progress; await invoke('app_update_download', { onProgress: channel }) },
  cancel: () => invoke('app_update_cancel'),
  beforeInstall: () => prepare?.() ?? Promise.resolve(false),
  install: () => withNativeOperation(() => invoke('app_update_install')),
  available: release => toast.info(`OnlyPing ${release.version} 可用`, { duration: 12000, action: { label: '查看更新', onClick: () => openSettings?.() } }),
})

export async function attachUpdates(callbacks: { beforeInstall: () => Promise<boolean>; settings: () => void }, active: () => boolean, register: (stop: () => void) => void) {
  if (!active()) return
  prepare = callbacks.beforeInstall; openSettings = callbacks.settings
  register(() => { if (prepare === callbacks.beforeInstall) { prepare = null; openSettings = null } })
  await appUpdates.initialize()
  if (!active() || !appUpdates.getSnapshot().info?.configured) return
  const timer = setTimeout(() => {
    // Re-read the preference immediately before checking, so disabling it during startup works.
    void invoke<DesktopInfo>('desktop_preferences').then(info => { if (active() && info.preferences.autoCheckUpdates) void appUpdates.check(true) }).catch(() => {})
  }, 10000)
  if (active()) register(() => clearTimeout(timer)); else clearTimeout(timer)
}

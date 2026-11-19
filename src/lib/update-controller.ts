export interface UpdateInfo { currentVersion: string; configured: boolean; reason?: string | null }
export interface UpdateRelease { version: string; notes: string; date?: string | null }
export interface UpdateProgress { downloaded: number; total?: number | null }
export interface UpdateSnapshot {
  info: UpdateInfo | null
  release: UpdateRelease | null
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'preparing' | 'installing'
  progress: UpdateProgress
  checkedAt: number | null
  error: string | null
}
interface Host {
  info(): Promise<UpdateInfo>
  check(): Promise<UpdateRelease | null>
  download(progress: (value: UpdateProgress) => void): Promise<void>
  cancel(): Promise<void>
  beforeInstall(): Promise<boolean>
  install(): Promise<void>
  available(release: UpdateRelease): void
}
export function createUpdateController(host: Host) {
  let state: UpdateSnapshot = { info: null, release: null, phase: 'idle', progress: { downloaded: 0 }, checkedAt: null, error: null }
  const listeners = new Set<() => void>()
  const set = (patch: Partial<UpdateSnapshot>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()) }
  let initialization: Promise<void> | null = null
  let cancelling = false
  const busy = () => ['checking', 'downloading', 'preparing', 'installing'].includes(state.phase)
  const canCheck = () => !busy() && state.phase !== 'ready'
  const message = (error: unknown) => typeof error === 'string' ? error : error instanceof Error ? error.message : '更新操作失败，请重试'
  const initialize = () => initialization ??= host.info().then(info => set({ info, error: null })).catch(error => { initialization = null; set({ error: message(error) }) })
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    initialize,
    isInstalling: () => state.phase === 'preparing' || state.phase === 'installing',
    async check(background = false) {
      if (!canCheck()) return
      await initialize()
      if (!canCheck() || !state.info?.configured) return
      set({ phase: 'checking', error: null })
      try {
        const release = await host.check()
        set({ release, phase: release ? 'available' : 'idle', checkedAt: Date.now(), progress: { downloaded: 0 } })
        if (release && background) host.available(release)
      } catch (error) { set({ phase: state.release ? 'available' : 'idle', error: message(error) }) }
    },
    async download() {
      if (busy() || state.phase === 'ready' || !state.release || !state.info?.configured) return
      cancelling = false
      set({ phase: 'downloading', error: null, progress: { downloaded: 0 } })
      try {
        await host.download(value => { if (state.phase === 'downloading' && !cancelling) set({ progress: value }) })
        set({ phase: cancelling ? 'available' : 'ready', error: cancelling ? '已取消下载' : null })
      } catch (error) { set({ phase: 'available', error: cancelling ? '已取消下载' : message(error) }) }
    },
    async cancel() {
      if (state.phase !== 'downloading' || cancelling) return
      cancelling = true
      try { await host.cancel() }
      catch (error) { cancelling = false; set({ error: message(error) }) }
    },
    async install() {
      if (state.phase !== 'ready') return
      set({ phase: 'preparing', error: null })
      try {
        if (!await host.beforeInstall()) { set({ phase: 'ready', error: '更新已推迟，当前内容仍保留' }); return }
        set({ phase: 'installing' })
        await host.install()
      } catch (error) { set({ phase: 'ready', error: message(error) }) }
    },
  }
}

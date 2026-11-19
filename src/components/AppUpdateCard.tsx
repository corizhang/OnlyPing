import { useEffect, useSyncExternalStore } from 'react'
import { Button } from './ui/button'
import { Progress } from './ui/progress'
import { appUpdates } from '@/lib/desktop-updates'
import type { createUpdateController } from '@/lib/update-controller'

export default function AppUpdateCard({ controller = appUpdates }: { controller?: ReturnType<typeof createUpdateController> }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => { void controller.initialize() }, [controller])
  const percent = state.progress.total ? Math.min(100, Math.round(state.progress.downloaded / state.progress.total * 100)) : undefined
  return <section aria-label="版本更新" className="space-y-3 border-t border-white/10 pt-5">
    <div className="flex items-center justify-between gap-4"><h3 className="text-sm font-medium">版本更新</h3><Button variant="outline" disabled={!state.info?.configured || !['idle', 'available'].includes(state.phase)} onClick={() => void controller.check()}>{state.phase === 'checking' ? '正在检查…' : '检查更新'}</Button></div>
    {!state.info ? <p role="status" className="text-xs text-[#aaa]">{state.error || '正在读取更新服务…'}{state.error && <Button size="sm" variant="ghost" onClick={() => void controller.initialize()}>重试</Button>}</p> : !state.info.configured ? <p role="status" className="text-xs text-[#aaa]">{state.info.reason}</p> : <>
      <p role="status" className="text-sm">{state.release ? `发现新版本 ${state.release.version}` : state.phase === 'checking' ? '正在检查更新…' : state.checkedAt && !state.error ? '当前已是最新版本' : '可手动检查，或在启动后自动检查更新'}</p>
      {state.checkedAt && <p className="text-xs text-[#999]">最近成功检查：{new Date(state.checkedAt).toLocaleString()}</p>}
      {state.release?.notes && <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-black/15 p-3 text-xs leading-relaxed text-[#bbb]">{state.release.notes}</div>}
      {state.phase === 'downloading' && <div className="space-y-2"><Progress aria-label="更新下载进度" value={percent} /><p className="text-xs text-[#aaa]">已下载 {(state.progress.downloaded / 1024 / 1024).toFixed(1)} MB{percent !== undefined ? ` · ${percent}%` : ''}</p><Button variant="ghost" size="sm" onClick={() => void controller.cancel()}>取消下载</Button></div>}
      {state.phase === 'available' && <Button onClick={() => void controller.download()}>下载更新</Button>}
      {state.phase === 'ready' && <><p className="text-xs text-[#aaa]">更新包已下载并通过签名验证；安装前将检查未保存内容。</p><Button onClick={() => void controller.install()}>安装并重启</Button></>}
      {['preparing', 'installing'].includes(state.phase) && <p role="status" className="text-sm text-[#aaa]">{state.phase === 'preparing' ? '正在检查并保存当前内容…' : '正在启动安装程序，请稍候…'}</p>}
      {state.error && <p role="alert" className="text-xs text-amber-300">{state.error}</p>}
    </>}
  </section>
}

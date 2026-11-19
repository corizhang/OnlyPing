import AppUpdateCard from './AppUpdateCard'
import { appUpdates } from '@/lib/desktop-updates'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Monitor, FolderOpen, SlidersHorizontal, ImageDown, Sparkles, Info, RotateCcw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Switch } from './ui/switch'
import AISettings from './AISettings'
import { isDesktop } from '@/lib/files'
import { workspaceInvoke, type WorkspaceInfo } from '@/lib/workspace'
import type { DesktopInfo, DesktopPreferences } from '@/lib/desktop-lifecycle'
import { readImageExportPreferences, saveImageExportPreferences, defaultImageExportPreferences } from '@/lib/image-export-preferences'
import type { AIConfig } from '@/types'
import packageInfo from '../../package.json'

const sections = [
  ['general', '常规', Monitor], ['storage', '项目与存储', FolderOpen], ['editor', '编辑器', SlidersHorizontal],
  ['export', '图片导出', ImageDown], ['ai', 'AI 与隐私', Sparkles], ['about', '关于', Info],
] as const
export type SettingsSection = typeof sections[number][0]
interface Props {
  initialSection: SettingsSection
  onClose: () => void
  onDirectory: () => Promise<void>
  onLibrary: () => void
  onResetLayout: () => void
  onResetTools: () => void
  onResetStyles: () => void
  onReorder: () => void
  onShortcuts: () => void
  config: AIConfig & { demo: boolean }
  onConfigChange: (config: AIConfig & { demo: boolean }) => void
  aiReady: boolean
  privacy: boolean
  onPrivacyChange: (value: boolean) => void
  autoScan: boolean
  onAutoScanChange: (value: boolean) => void
  aiBusy: boolean
}
const selectClass = 'h-9 min-w-40 rounded border border-white/15 bg-[#303030] px-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'
function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-6 border-b border-white/10 py-4"><div className="min-w-0"><div className="text-sm font-medium">{title}</div>{description && <p className="mt-1 text-xs leading-relaxed text-[#aaa]">{description}</p>}</div><div className="shrink-0">{children}</div></div>
}

export default function AppSettings(props: Props) {
  const desktop = isDesktop()
  const updateState = useSyncExternalStore(appUpdates.subscribe, appUpdates.getSnapshot)
  const updating = updateState.phase === 'preparing' || updateState.phase === 'installing'
  const [section, setSection] = useState<SettingsSection>(props.initialSection)
  const [info, setInfo] = useState<DesktopInfo | null>(null)
  const [directory, setDirectory] = useState('')
  const [storageLocation, setStorageLocation] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [confirmReset, setConfirmReset] = useState<'tools' | 'styles' | 'layout' | null>(null)
  const [options, setOptions] = useState(() => readImageExportPreferences(desktop))
  const [sizeValue, setSizeValue] = useState(() => options.size.mode === 'original' ? '50' : String(options.size.value))
  useEffect(() => {
    if (!desktop) return
    let active = true
    void Promise.allSettled([
      workspaceInvoke<DesktopInfo>('desktop_preferences'),
      workspaceInvoke<WorkspaceInfo>('workspace_info'),
      workspaceInvoke<string>('project_storage_location'),
    ]).then(([settings, workspace, storage]) => {
      if (!active) return
      if (settings.status === 'fulfilled') setInfo(settings.value)
      if (workspace.status === 'fulfilled') setDirectory(workspace.value.directory)
      if (storage.status === 'fulfilled') setStorageLocation(storage.value)
      if (settings.status === 'rejected' || workspace.status === 'rejected' || storage.status === 'rejected') setNote('部分设置读取失败，请重试；未修改现有配置。')
    })
    return () => { active = false }
  }, [desktop, attempt])
  const saveDesktop = async (preferences: DesktopPreferences) => {
    if (!info || busy) return
    setBusy(true)
    try { await workspaceInvoke('desktop_save_preferences', { preferences }); setInfo({ ...info, preferences }); setNote('设置已保存') }
    catch (error) { setNote(error instanceof Error ? error.message : '设置保存失败') }
    finally { setBusy(false) }
  }
  const title = sections.find(item => item[0] === section)![1]
  return <Dialog open onOpenChange={open => { if (!open && !busy && !updating) props.onClose() }}><DialogContent showCloseButton={!busy && !updating} className="ps-workspace flex h-[min(700px,88vh)] max-w-[calc(100%-3rem)] flex-col gap-0 overflow-hidden border-white/15 bg-[#282828] p-0 text-[#ddd] sm:max-w-[900px]">
    <DialogHeader className="shrink-0 border-b border-white/10 px-6 py-4"><DialogTitle>设置</DialogTitle><DialogDescription>管理 OnlyPing 的应用行为和默认偏好</DialogDescription></DialogHeader>
    <div className="flex min-h-0 flex-1"><nav aria-label="设置分类" className="w-44 shrink-0 space-y-1 border-r border-white/10 bg-[#242424] p-3">{sections.map(([key, label, Icon]) => <button key={key} type="button" disabled={updating} aria-current={section === key ? 'page' : undefined} onClick={() => { setSection(key); setNote(''); setConfirmReset(null) }} className={`flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-sm ${section === key ? 'bg-[#3c5871] text-white' : 'text-[#aaa] hover:bg-white/5 hover:text-white'}`}><Icon className="size-4" />{label}</button>)}</nav>
      <main aria-label={title} className="min-w-0 flex-1 overflow-y-auto px-7 py-5"><h2 className="mb-2 text-base font-semibold text-white">{title}</h2>
        {section === 'general' && <>
          {!desktop ? <p className="mt-5 text-sm text-[#aaa]">窗口与系统托盘设置仅在桌面应用中可用。</p> : <fieldset disabled={busy || updating || !info}>
            <Row title="关闭主窗口时" description="退出前会检查未保存内容；隐藏后可从托盘恢复。"><select aria-label="关闭主窗口时" className={selectClass} value={info?.preferences.closeBehavior ?? 'ask'} onChange={e => void saveDesktop({ ...info!.preferences, closeBehavior: e.target.value as DesktopPreferences['closeBehavior'] })}><option value="ask">每次询问</option><option value="tray" disabled={!info?.trayAvailable}>隐藏到托盘</option><option value="exit">退出应用</option></select></Row>
            <Row title="最小化到托盘" description="关闭时行为与最小化行为可以分别设置。"><Switch aria-label="最小化到托盘" disabled={!info?.trayAvailable} checked={info?.preferences.minimizeToTray ?? false} onCheckedChange={value => void saveDesktop({ ...info!.preferences, minimizeToTray: value })} /></Row>
            <Row title="记住窗口布局" description="下次启动恢复窗口大小、位置和最大化状态；显示器变化时自动调整到可见区域。关闭后下次使用默认布局。"><Switch aria-label="记住窗口布局" checked={info?.preferences.rememberWindow ?? true} onCheckedChange={value => void saveDesktop({ ...info!.preferences, rememberWindow: value })} /></Row>
            <Row title="启动后自动检查更新" description="后台检测新版本；下载与安装均由你决定。"><Switch aria-label="启动后自动检查更新" checked={info?.preferences.autoCheckUpdates ?? true} onCheckedChange={value => void saveDesktop({ ...info!.preferences, autoCheckUpdates: value })} /></Row>
            <p className="mt-4 text-xs leading-relaxed text-[#aaa]">重复启动 OnlyPing 会恢复已有窗口，避免同时打开多个实例。</p>
            {info && !info.trayAvailable && <p className="mt-4 text-xs text-amber-400">系统托盘不可用，将使用正常窗口退出行为。</p>}
          </fieldset>}
        </>}
        {section === 'storage' && <>
          <Row title="新项目默认保存目录" description={desktop ? '修改后用于新项目；已有项目保持原保存位置。' : '浏览器通过下载或文件选择器保存项目。'}><Button variant="outline" disabled={!desktop || busy} onClick={async () => { setBusy(true); try { await props.onDirectory(); setAttempt(n => n + 1) } finally { setBusy(false) } }}>更改目录</Button></Row>
          {desktop && <p className="mt-3 break-all rounded bg-black/15 p-3 text-xs leading-relaxed text-[#aaa]">{directory || '正在读取目录…'}</p>}
          <Row title="本机恢复存档" description="编辑内容自动保存在本机。恢复存档与项目文件分别管理，Ctrl+S 用于更新项目文件。"><Button variant="outline" onClick={() => { props.onClose(); props.onLibrary() }}>管理存档</Button></Row>
          {desktop && <><Row title="应用数据目录" description="存放本机恢复存档与图片资源。请勿在应用运行时手动修改数据库。"><Button variant="outline" onClick={async () => { try { await workspaceInvoke('project_storage_open_directory'); setNote('已打开应用数据目录') } catch { setNote('目录打开失败，可复制下方路径手动查看') } }}>打开目录</Button></Row><p className="mt-3 select-text break-all text-xs text-[#aaa]">{storageLocation || '正在读取…'}</p></>}
        </>}
        {section === 'editor' && <>
          <Row title="工具栏顺序" description="可拖动排序，也可使用 Alt + ↑/↓ 调整。"><Button variant="outline" onClick={() => { props.onClose(); props.onReorder() }}>调整顺序</Button></Row>
          <Row title="快捷键" description="查看工具选择、撤销重做和文件操作快捷键。"><Button variant="outline" onClick={() => { props.onClose(); props.onShortcuts() }}>查看快捷键</Button></Row>
          {([['tools', '恢复默认工具顺序'], ['styles', '恢复所有工具默认样式'], ['layout', '恢复面板布局']] as const).map(([key, label]) => <Row key={key} title={label} description={key === 'styles' ? '仅影响新建标注，已有标注和样式预设不变。' : undefined}><Button variant="ghost" onClick={() => setConfirmReset(key)}><RotateCcw className="size-4" />恢复默认</Button></Row>)}
          {confirmReset && <div role="alert" className="mt-4 space-y-3 rounded border border-amber-400/30 p-4"><p className="text-sm">确认恢复{confirmReset === 'styles' ? '所有工具默认样式' : confirmReset === 'tools' ? '默认工具顺序' : '面板布局'}？</p><div className="flex gap-2"><Button size="sm" onClick={() => { if (confirmReset === 'styles') props.onResetStyles(); else if (confirmReset === 'tools') props.onResetTools(); else props.onResetLayout(); setConfirmReset(null); setNote('已恢复默认') }}>确认恢复</Button><Button size="sm" variant="ghost" onClick={() => setConfirmReset(null)}>取消</Button></div></div>}
        </>}
        {section === 'export' && <>
          <p className="mt-2 text-xs leading-relaxed text-[#aaa]">用于单张或批量标注图片导出。导出窗口仍可临时调整；文档排版样式随项目保存。</p>
          <Row title="图片格式"><select aria-label="默认图片格式" className={selectClass} value={options.format} onChange={e => setOptions({ ...options, format: e.target.value as 'png' | 'jpeg' })}><option value="png">PNG · 无损透明</option><option value="jpeg">JPEG · 白色背景</option></select></Row>
          <Row title="JPEG 质量" description="质量越高，文件通常越大。"><Input aria-label="默认 JPEG 质量" type="number" min={1} max={100} className="w-24" disabled={options.format !== 'jpeg'} value={options.quality} onChange={e => setOptions({ ...options, quality: Number(e.target.value) })} /></Row>
          <Row title="图片尺寸"><select aria-label="默认图片尺寸" className={selectClass} value={options.size.mode} onChange={e => setOptions({ ...options, size: e.target.value === 'original' ? { mode: 'original' } : { mode: e.target.value as 'percent' | 'maxWidth', value: Number(sizeValue) } })}><option value="original">原始尺寸</option><option value="percent">按百分比缩小</option><option value="maxWidth">限制最大宽度</option></select></Row>
          {options.size.mode !== 'original' && <Row title={options.size.mode === 'percent' ? '缩放比例（1–100%）' : '最大宽度（px）'}><Input aria-label="默认尺寸数值" type="number" className="w-28" value={sizeValue} onChange={e => { setSizeValue(e.target.value); setOptions({ ...options, size: { mode: options.size.mode as 'percent' | 'maxWidth', value: Number(e.target.value) } }) }} /></Row>}
          <Row title="序号规则"><select aria-label="默认序号规则" className={selectClass} value={options.numbering} onChange={e => setOptions({ ...options, numbering: e.target.value as 'project' | 'per-image' })}><option value="project">沿用项目连续编号</option><option value="per-image">每张图片重新编号</option></select></Row>
          {desktop && <Row title="默认导出方式"><select aria-label="默认导出方式" className={selectClass} value={options.destination} onChange={e => setOptions({ ...options, destination: e.target.value as 'download' | 'folder' })}><option value="download">保存图片 / ZIP 文件</option><option value="folder">选择文件夹批量写入</option></select></Row>}
          <div className="mt-5 flex gap-2"><Button onClick={() => setNote(saveImageExportPreferences(options) ? '导出默认设置已保存' : '保存失败，请检查数值范围或本机存储；原设置未被覆盖')}>保存导出默认值</Button><Button variant="ghost" onClick={() => { const defaults = defaultImageExportPreferences(); if (saveImageExportPreferences(defaults)) { setOptions(defaults); setSizeValue('50'); setNote('已恢复导出默认值') } else setNote('恢复失败，请检查本机存储') }}>恢复默认</Button></div>
        </>}
        {section === 'ai' && <>
          <Row title="发送完整标注图" description="关闭后仍会在本地应用马赛克和实色遮挡再发送。"><Switch aria-label="发送完整标注图" checked={props.privacy} onCheckedChange={props.onPrivacyChange} disabled={props.aiBusy} /></Row>
          <Row title="导出前自动进行 AI 隐私扫描" description="需要可用的 AI 配置；截图会发送至已配置的接口。"><Switch aria-label="自动 AI 隐私扫描" checked={props.autoScan} onCheckedChange={props.onAutoScanChange} /></Row>
          <div className="mt-5">{!props.aiReady ? <p role="status">正在读取 AI 配置…</p> : props.aiBusy ? <p role="status" className="text-sm text-[#aaa]">AI 任务进行中，请完成或取消任务后修改接口配置。</p> : <AISettings config={props.config} onChange={props.onConfigChange} />}</div>
        </>}
        {section === 'about' && <div className="mt-6 space-y-4"><div className="text-2xl font-semibold text-white">OnlyPing <span className="ml-2 text-sm font-normal text-[#aaa]">{packageInfo.version}</span></div><p className="text-sm text-[#aaa]">截图标注与步骤说明工作台</p><p className="text-xs text-[#999]">运行环境：{desktop ? 'Tauri 桌面应用' : '浏览器'}</p><p className="break-all text-xs text-[#999]">项目地址：https://github.com/corizhang/OnlyPing</p>{desktop && <AppUpdateCard />}</div>}
      </main></div>
    <footer className="flex h-14 shrink-0 items-center justify-between gap-4 border-t border-white/10 px-6"><p role="status" className="min-w-0 text-xs text-[#aaa]">{note || '常规设置即时保存；AI 和导出配置请点击各自的保存按钮。'}</p><div className="flex shrink-0 gap-2">{desktop && <Button variant="ghost" size="sm" disabled={busy || updating} onClick={() => setAttempt(n => n + 1)}>重新读取</Button>}<Button variant="outline" disabled={busy || updating} onClick={props.onClose}>完成</Button></div></footer>
  </DialogContent></Dialog>
}

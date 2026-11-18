import { useEffect, useRef, useState } from 'react'
import { FilePlus2, FolderOpen, Image as ImageIcon, Settings2, ArrowRight, Search, Pin, X } from 'lucide-react'
import type { LibraryAction, WorkspaceInfo, WorkspaceEntry } from '@/lib/workspace'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { LocalProjectEntry } from '@/lib/db'
import { projectStartItems, type StartItem } from '@/lib/project-start-items'

export default function ProjectStart({ info, recoveries = [], loading, error, onNew, onOpen, onDirectory, onRecent, onDraft, onRecovery, onContinue, onRetry, busy, search = '', onSearchChange, onLibraryChange }: {
  info: WorkspaceInfo | null; loading: boolean; error: string; busy: boolean
  search?: string; onSearchChange?: (value: string) => void
  onLibraryChange?: (action: LibraryAction, id?: string) => Promise<void>
  recoveries?: LocalProjectEntry[]; onDraft?: (entry: LocalProjectEntry) => void
  onNew: () => void; onOpen: () => void; onDirectory: () => void; onRecent: (entry: WorkspaceEntry) => void; onRecovery: () => void; onContinue: () => void; onRetry: () => void
}) {
  const root = useRef<HTMLElement>(null)
  const [removing, setRemoving] = useState<StartItem | null>(null)
  const [updating, setUpdating] = useState(false)
  const [actionError, setActionError] = useState('')
  const items = projectStartItems(info?.projects ?? [], recoveries, info?.preferences, search)
  const locked = busy || updating
  const hiddenCount = info?.preferences?.hidden.length ?? 0
  useEffect(() => { root.current?.focus() }, [])
  const update = async (action: LibraryAction, id?: string) => {
    if (!onLibraryChange || locked) return
    setUpdating(true); setActionError('')
    try { await onLibraryChange(action, id); if (action === 'hide') setRemoving(null) }
    catch (error) { setActionError(error instanceof Error ? error.message : '最近项目更新失败，请重试') }
    finally { setUpdating(false) }
  }
  return <main ref={root} tabIndex={-1} onKeyDownCapture={event => event.stopPropagation()} className="fixed inset-0 z-40 overflow-y-auto bg-[#252525] text-[#ddd] outline-none">
    <div className="mx-auto max-w-6xl px-8 py-12">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-6">
        <div><p className="mb-2 text-xs tracking-[.2em] text-[#999]">ONLYPING</p><h1 className="text-3xl font-semibold">项目</h1><p className="mt-3 text-sm text-[#aaa]">整理截图、标注重点，继续完成你的操作指引。</p></div>
        <Button variant="outline" disabled={locked} onClick={onContinue}>继续上次工作区<ArrowRight className="ml-2 size-4" /></Button>
      </header>
      <div className="mb-8 flex flex-wrap gap-3">
        <Button disabled={locked} onClick={onNew}><FilePlus2 className="mr-2 size-4" />新建项目</Button>
        <Button variant="outline" disabled={locked} onClick={onOpen}><FolderOpen className="mr-2 size-4" />打开项目文件</Button>
        <Button variant="ghost" disabled={locked} onClick={onRecovery}>本机恢复存档与历史</Button>
      </div>
      <div className="mb-8 flex items-center gap-3 rounded border border-white/10 bg-[#2c2c2c] px-4 py-3">
        <Settings2 className="size-4 shrink-0 text-[#aaa]" /><div className="min-w-0 flex-1"><p className="text-xs text-[#aaa]">新项目默认保存目录</p><p className="mt-1 break-all text-sm">{info?.directory ?? '正在读取项目目录…'}</p></div>
        <Button variant="outline" size="sm" disabled={locked || loading} onClick={onDirectory}>更改目录</Button>
      </div>
      {error && <p role="alert" className="mb-5 text-sm text-red-300">{error}<Button disabled={locked} size="sm" variant="ghost" onClick={onRetry}>重试</Button></p>}
      {!removing && actionError && <p role="alert" className="mb-5 text-sm text-red-300">{actionError}</p>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-medium">最近项目</h2><p className="mt-1 text-xs text-[#999]">固定项目优先 · 最多显示 12 个项目</p></div>
        <div className="flex flex-wrap items-center gap-3">
          {hiddenCount > 0 && <Button variant="ghost" size="sm" disabled={locked || loading || !onLibraryChange} onClick={() => void update('restore-all')}>恢复移除记录（{hiddenCount}）</Button>}
          <div className="flex items-center gap-2 rounded border border-white/15 bg-[#202020] px-3 focus-within:border-[#669acb]">
            <Search aria-hidden="true" className="size-4 shrink-0 text-[#999]" />
            <input aria-label="搜索项目" placeholder="搜索名称或文件路径" maxLength={200} value={search} disabled={locked || !onSearchChange} onChange={event => onSearchChange?.(event.target.value)} className="h-9 w-48 bg-transparent text-sm outline-none placeholder:text-[#888] sm:w-56" />
            {search && <button aria-label="清除搜索" disabled={locked} onClick={() => onSearchChange?.('')} className="rounded p-1 hover:bg-white/10"><X className="size-3" /></button>}
          </div>
        </div>
      </div>
      <div role="status" className="mb-3 min-h-4 text-xs text-[#999]">{loading ? '正在更新最近项目…' : updating ? '正在保存列表设置…' : search ? `找到 ${items.length} 个项目${items.length === 12 ? '（显示前 12 个）' : ''}` : ''}</div>
      {!items.length ? <div className="rounded border border-dashed border-white/15 p-12 text-center text-sm text-[#aaa]">{loading ? '正在读取最近项目…' : search ? '没有匹配的项目，试试其他名称或路径。' : '还没有最近项目。新建后按 Ctrl+S 保存，或打开已有项目文件。'}</div> : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {items.map(item => <article key={item.id} className="min-w-0 overflow-hidden rounded border border-white/10 bg-[#2e2e2e]">
          <button disabled={locked || loading} className="block w-full text-left hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#669acb] disabled:opacity-50" aria-label={`打开项目 ${item.title}`} onClick={() => item.file ? onRecent(item.file) : item.recovery && onDraft?.(item.recovery)}>
            <div className="relative flex h-36 items-center justify-center bg-[#202020]">{item.file?.thumbnail ? <img src={item.file.thumbnail} alt="" loading="lazy" className="max-h-full max-w-full object-contain" /> : <ImageIcon className="size-8 text-[#666]" />}{item.pinned && <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-[#354a60] px-2 py-1 text-[11px]"><Pin className="size-3" />已固定</span>}</div>
            <div className="p-4"><h3 className="truncate font-medium">{item.title || '未命名项目'}</h3><p className="mt-2 text-xs text-[#aaa]">{item.pages} 张图片 · {new Date(item.updatedAt).toLocaleDateString()}</p><p className="mt-2 text-xs text-[#aaa]">{item.file ? '项目文件' : '本机草稿 · 尚未另存为文件'}{item.file && item.recovery ? ' · 含恢复存档' : ''}</p>{item.file && <p title={item.file.path} className="mt-2 truncate text-[11px] text-[#999]">{item.file.path}</p>}{item.file && !item.file.available && <p className="mt-2 text-xs text-amber-300">文件找不到 · 可选择恢复存档</p>}</div>
          </button>
          <div className="flex items-center justify-between border-t border-white/10 px-2 py-1">
            <Button variant="ghost" size="sm" aria-label={`${item.pinned ? '取消固定项目' : '固定项目'} ${item.title}`} aria-pressed={item.pinned} disabled={locked || loading || !onLibraryChange} onClick={() => void update(item.pinned ? 'unpin' : 'pin', item.id)}><Pin className="mr-1 size-3.5" />{item.pinned ? '取消固定' : '固定'}</Button>
            <Button variant="ghost" size="sm" aria-label={`从最近列表移除 ${item.title}`} title="仅移除列表记录，不删除项目文件或恢复存档" disabled={locked || loading || !onLibraryChange} onClick={() => { setActionError(''); setRemoving(item) }}>移除记录</Button>
          </div>
        </article>)}
      </div>}
      <p className="mt-8 text-xs leading-6 text-[#999]">Ctrl+S 保存项目文件；本机自动存档保留恢复副本。更改默认目录只影响新项目，已有项目继续写回原文件。</p>
    </div>
    <Dialog open={!!removing} onOpenChange={open => { if (!open && !updating) setRemoving(null) }}><DialogContent><DialogHeader><DialogTitle>从最近列表移除？</DialogTitle><DialogDescription>“{removing?.title}”将从首页隐藏并取消固定。项目文件、本机恢复存档和文件关联都会保留。可通过“恢复移除记录”重新显示；再次打开或保存项目文件也会重新显示。</DialogDescription></DialogHeader>{actionError && <p role="alert" className="text-sm text-red-400">{actionError}</p>}<div className="flex justify-end gap-2"><Button variant="outline" disabled={updating} onClick={() => setRemoving(null)}>取消</Button><Button disabled={locked} onClick={() => removing && void update('hide', removing.id)}>移除记录</Button></div></DialogContent></Dialog>
  </main>
}

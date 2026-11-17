import { useEffect, useRef } from 'react'
import { FilePlus2, FolderOpen, Image as ImageIcon, Settings2, ArrowRight } from 'lucide-react'
import type { WorkspaceInfo, WorkspaceEntry } from '@/lib/workspace'
import { Button } from '@/components/ui/button'
export default function ProjectStart({ info, loading, error, onNew, onOpen, onDirectory, onRecent, onRecovery, onContinue, onRetry, busy }: {
  info: WorkspaceInfo | null; loading: boolean; error: string; busy: boolean
  onNew: () => void; onOpen: () => void; onDirectory: () => void; onRecent: (entry: WorkspaceEntry) => void; onRecovery: () => void; onContinue: () => void; onRetry: () => void
}) {
  const root = useRef<HTMLElement>(null)
  useEffect(() => { root.current?.focus() }, [])
  return <main ref={root} tabIndex={-1} onKeyDownCapture={event => event.stopPropagation()} className="fixed inset-0 z-40 overflow-y-auto bg-[#252525] text-[#ddd] outline-none">
    <div className="mx-auto max-w-6xl px-8 py-12"><header className="mb-10 flex flex-wrap items-center justify-between gap-6"><div><p className="mb-2 text-xs tracking-[.2em] text-[#999]">ONLYPING</p><h1 className="text-3xl font-semibold">项目</h1><p className="mt-3 text-sm text-[#aaa]">整理截图、标注重点，继续完成你的操作指引。</p></div><Button variant="outline" disabled={busy} onClick={onContinue}>继续上次工作区<ArrowRight className="ml-2 size-4" /></Button></header>
      <div className="mb-8 flex flex-wrap gap-3"><Button disabled={busy} onClick={onNew}><FilePlus2 className="mr-2 size-4" />新建项目</Button><Button variant="outline" disabled={busy} onClick={onOpen}><FolderOpen className="mr-2 size-4" />打开项目文件</Button><Button variant="ghost" disabled={busy} onClick={onRecovery}>本机恢复存档与历史</Button></div>
      <div className="mb-8 flex items-center gap-3 rounded border border-white/10 bg-[#2c2c2c] px-4 py-3"><Settings2 className="size-4 shrink-0 text-[#aaa]" /><div className="min-w-0 flex-1"><p className="text-xs text-[#aaa]">新项目默认保存目录</p><p className="mt-1 break-all text-sm">{info?.directory ?? '正在读取项目目录…'}</p></div><Button variant="outline" size="sm" disabled={busy || loading} onClick={onDirectory}>更改目录</Button></div>
      {error && <p role="alert" className="mb-5 text-sm text-red-300">{error}<Button size="sm" variant="ghost" onClick={onRetry}>重试</Button></p>}
      <div className="mb-4 flex items-center justify-between"><h2 className="font-medium">最近项目</h2><span className="text-xs text-[#999]">最多显示 12 个项目</span></div>
      {loading ? <p role="status" className="py-12 text-sm text-[#aaa]">正在读取最近项目…</p> : !info?.projects.length ? <div className="rounded border border-dashed border-white/15 p-12 text-center text-sm text-[#aaa]">还没有已保存的项目。新建后按 Ctrl+S，即可直接保存到默认目录。</div> : <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">{info.projects.map(entry => <article key={entry.id} className="min-w-0 overflow-hidden rounded border border-white/10 bg-[#2e2e2e]"><button disabled={busy} className="block w-full text-left hover:bg-white/5 disabled:opacity-50" aria-label={`打开项目 ${entry.title}`} onClick={() => onRecent(entry)}><div className="flex h-36 items-center justify-center bg-[#202020]">{entry.thumbnail ? <img src={entry.thumbnail} alt="" loading="lazy" className="max-h-full max-w-full object-contain" /> : <ImageIcon className="size-8 text-[#666]" />}</div><div className="p-4"><h3 className="truncate font-medium">{entry.title || '未命名项目'}</h3><p className="mt-2 text-xs text-[#aaa]">{entry.pages} 张图片 · {new Date(entry.accessedAt).toLocaleDateString()}</p><p title={entry.path} className="mt-2 truncate text-[11px] text-[#999]">{entry.path}</p>{!entry.available && <p className="mt-2 text-xs text-amber-300">文件找不到 · 点击重新定位</p>}</div></button></article>)}</div>}
      <p className="mt-8 text-xs leading-6 text-[#999]">Ctrl+S 保存项目文件；本机自动存档保留恢复副本。更改默认目录只影响新项目，已有项目继续写回原文件。</p>
    </div>
  </main>
}

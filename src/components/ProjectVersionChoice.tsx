import type { ProjectData } from '@/lib/db'
import type { ProjectFileSource, PreviousProjectLocation } from '@/lib/project-files'
import type { WorkspaceEntry } from '@/lib/workspace'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
export interface ProjectVersions { entry: WorkspaceEntry; file: ProjectData | null; source: ProjectFileSource | null; recovery: ProjectData | null; message: string; location?: PreviousProjectLocation; error?: string }
export default function ProjectVersionChoice({ versions, busy, onChoose, onClose, onLocate }: { versions: ProjectVersions; busy: boolean; onChoose: (choice: 'file' | 'recovery' | 'copy') => void; onClose: () => void; onLocate: () => void }) {
  const time = (value: number | undefined) => value ? new Date(value).toLocaleString() : '时间未知'
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>选择要打开的版本</DialogTitle><DialogDescription>{versions.message}</DialogDescription></DialogHeader>
    {versions.error && <p role="alert" className="text-sm text-red-400">{versions.error}</p>}
    {versions.location && <div className="rounded border border-blue-400/30 bg-blue-400/5 p-3 text-xs leading-6"><p>已校验为同一个项目，尚未更新文件关联。</p><p className="break-all text-muted-foreground">原位置：{versions.location.path}</p><p>打开文件或恢复修改时，将关联到下方新位置；取消及另存副本不会更改原关联。</p></div>}
    <div className="grid gap-3 sm:grid-cols-2"><section className="rounded border p-4"><h3 className="font-medium">{versions.location ? '新位置的项目文件' : '项目文件'}</h3><p className="mt-2 break-all text-xs text-muted-foreground">{versions.entry.path}</p><p className="mt-3 text-sm">{versions.file?.title ?? '文件无法读取'}</p><p className="mt-2 text-xs text-muted-foreground">{versions.file ? `${versions.file.pages.length} 张图片` : '文件缺失、损坏或无法访问'} · {versions.location ? '原文件最近确认' : '最近确认'} {time(versions.entry.savedAt)}</p><Button className="mt-4" variant="outline" disabled={busy || !versions.file} onClick={() => onChoose('file')}>{versions.location ? '关联并打开项目文件' : '打开项目文件'}</Button></section>
    <section className="rounded border p-4"><h3 className="font-medium">本机恢复存档</h3><p className="mt-2 text-xs text-muted-foreground">包含本机自动保存的内容，可能尚未写入项目文件。</p><p className="mt-3 text-sm">{versions.recovery?.title ?? '没有可用恢复存档'}</p><p className="mt-2 text-xs text-muted-foreground">{versions.recovery ? `${versions.recovery.pages.length} 张图片` : '无法恢复'} · {time(versions.recovery?.savedAt)}</p><Button className="mt-4" disabled={busy || !versions.recovery} onClick={() => onChoose('recovery')}>{versions.location ? '关联新位置并恢复修改' : '恢复未保存修改'}</Button></section></div>
    <p className="text-xs text-muted-foreground">选择后不会自动覆盖原项目文件。恢复存档另存为副本会生成独立项目文件，保留原项目关联。</p>
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={onLocate}>重新定位文件</Button><Button variant="outline" disabled={busy || !versions.recovery} onClick={() => onChoose('copy')}>恢复存档另存为副本</Button><Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button></div>
  </DialogContent></Dialog>
}

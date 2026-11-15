import { Eye, EyeOff, Lock, LockOpen } from 'lucide-react'
import { annotationLabel } from '@/lib/tools/catalog'
import { toggleSelection } from '@/lib/selection'
import type { Annotation } from '@/types'

export default function AnnotationList({ annotations, selectedIds, onSelectionChange, onChange, numberStart = 0 }: {
  annotations: Annotation[]; selectedIds: string[]
  numberStart?: number
  onSelectionChange: (ids: string[]) => void; onChange: (annotations: Annotation[]) => void
}) {
  const numberIds = annotations.filter(a => a.kind === 'number' && !a.hidden).map(a => a.id)
  return <details className="shrink-0 border-t border-white/10 bg-[#262626] text-[#ddd]">
    <summary className="cursor-pointer px-3 py-2 text-xs">标注对象 · {annotations.length}</summary>
    <p className="px-3 pb-2 text-[10px] text-[#999]">Shift 点击多选 · 隐藏对象不参与导出</p>
    <div className="max-h-44 overflow-auto">
      {[...annotations].reverse().map((a, index) => <div key={a.id} className={`flex items-center gap-1 px-2 ${selectedIds.includes(a.id) ? 'bg-[#36577e]' : ''}`}>
        <button type="button" aria-pressed={selectedIds.includes(a.id)} onClick={e => onSelectionChange(toggleSelection(selectedIds, a.id, e.shiftKey || e.ctrlKey || e.metaKey))} className={`min-w-0 flex-1 truncate py-2 text-left text-xs ${a.hidden ? 'opacity-50' : ''}`} title={'text' in a ? a.text : annotationLabel(a)}>{annotationLabel(a)} {a.kind === 'number' ? a.hidden ? '（隐藏）' : numberStart + numberIds.indexOf(a.id) + 1 : annotations.length - index}{'text' in a && a.text ? ` · ${a.text}` : ''}</button>
        <button type="button" aria-label={`${a.hidden ? '显示' : '隐藏'}标注 ${annotations.length - index}`} title={a.hidden ? '显示并参与导出' : '隐藏，不参与导出'} onClick={() => onChange(annotations.map(item => item.id === a.id ? { ...item, hidden: !a.hidden } : item))} className="p-1.5 hover:bg-white/10">{a.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
        <button type="button" aria-label={`${a.locked ? '解锁' : '锁定'}标注 ${annotations.length - index}`} title={a.locked ? '解锁' : '锁定，防止修改'} onClick={() => onChange(annotations.map(item => item.id === a.id ? { ...item, locked: !a.locked } : item))} className="p-1.5 hover:bg-white/10">{a.locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}</button>
      </div>)}
      {!annotations.length && <p className="px-3 pb-3 text-xs text-[#999]">暂无标注</p>}
    </div>
  </details>
}

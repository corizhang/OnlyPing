import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import type { CloseChoice } from '@/lib/desktop-lifecycle'

export default function DesktopCloseChoice({ available, onChoice }: { available: boolean; onChoice: (choice: CloseChoice | null) => void }) {
  const [remember, setRemember] = useState(false)
  return <Dialog open onOpenChange={open => { if (!open) onChoice(null) }}><DialogContent>
    <DialogHeader><DialogTitle>关闭 OnlyPing</DialogTitle><DialogDescription>隐藏后可通过系统托盘重新打开。退出前会检查未保存内容。</DialogDescription></DialogHeader>
    {!available && <p className="text-sm text-amber-400">系统托盘不可用，当前只能正常退出。</p>}
    <label className="flex items-center gap-2 text-sm"><Checkbox checked={remember} onCheckedChange={value => setRemember(value === true)} />记住选择（可在设置中修改）</label>
    <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onChoice(null)}>取消</Button><Button variant="outline" onClick={() => onChoice({ behavior: 'exit', remember })}>退出应用</Button><Button disabled={!available} onClick={() => onChoice({ behavior: 'tray', remember })}>隐藏到托盘</Button></div>
  </DialogContent></Dialog>
}

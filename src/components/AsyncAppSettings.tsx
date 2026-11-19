import { useEffect, useState, type ComponentProps } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { Button } from './ui/button'
type Settings = typeof import('./AppSettings').default
export default function AsyncAppSettings(props: ComponentProps<Settings>) {
  const [loaded, setLoaded] = useState<{ Component: Settings } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    import('./AppSettings').then(module => { if (active) setLoaded({ Component: module.default }) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [attempt])
  if (loaded) return <loaded.Component {...props} />
  return <Dialog open onOpenChange={open => { if (!open) props.onClose() }}><DialogContent><DialogHeader><DialogTitle>设置</DialogTitle><DialogDescription>{failed ? '设置页加载失败，项目内容仍保留。' : '正在加载设置…'}</DialogDescription></DialogHeader>{failed && <Button onClick={() => { setFailed(false); setAttempt(n => n + 1) }}>重试</Button>}</DialogContent></Dialog>
}

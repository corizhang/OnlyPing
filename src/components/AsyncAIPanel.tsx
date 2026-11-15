import { useEffect, useState, type ComponentProps } from 'react'
import { Button } from '@/components/ui/button'

type AIPanelComponent = typeof import('./AIPanel').default
type Props = ComponentProps<AIPanelComponent> & { enabled: boolean }

/** Keep the mounted panel alive after first use, including when its tab is hidden. */
export default function AsyncAIPanel({ enabled, ...props }: Props) {
  const [loaded, setLoaded] = useState<{ Component: AIPanelComponent } | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled || loaded) return
    let active = true
    setError(false)
    import('./AIPanel').then(module => {
      if (active) setLoaded({ Component: module.default })
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [enabled, loaded, attempt])
  if (loaded) return <loaded.Component {...props} />
  if (!enabled) return null
  return <div role="status" className="space-y-3 p-4 text-sm text-muted-foreground">
    {error ? <><p>AI 面板加载失败，请检查网络后重试。编辑内容仍保留在当前项目中。</p><Button variant="outline" onClick={() => setAttempt(n => n + 1)}>重新加载 AI 面板</Button></> : '正在加载 AI 辅助…'}
  </div>
}

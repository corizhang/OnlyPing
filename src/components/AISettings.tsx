import { useState } from 'react'
import { Input } from './ui/input'
import { Button } from './ui/button'
import { Switch } from './ui/switch'
import { saveAIConfig } from '@/lib/ai-config'
import { isDesktop } from '@/lib/files'
import type { AIConfig } from '@/types'

export default function AISettings({ config, onChange }: { config: AIConfig & { demo: boolean }; onChange: (config: AIConfig & { demo: boolean }) => void }) {
  const [draft, setDraft] = useState(config)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const save = async () => {
    if (busy) return
    try {
      const url = new URL(draft.baseUrl)
      if (!['http:', 'https:'].includes(url.protocol) || !draft.model.trim()) throw Error('请填写有效的 HTTP(S) 接口地址和模型名称')
      setBusy(true)
      const next = { ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), demo: !draft.apiKey.trim() }
      await saveAIConfig(next)
      onChange(next); setNote('AI 配置已保存')
    } catch (error) { setNote(error instanceof Error ? error.message : '配置保存失败，原配置仍然有效') }
    finally { setBusy(false) }
  }
  return <fieldset disabled={busy} className="space-y-4">
    <label className="block space-y-2 text-sm"><span>接口地址</span><Input value={draft.baseUrl} onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.moonshot.cn/v1" /></label>
    <label className="block space-y-2 text-sm"><span>视觉模型</span><Input value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} /></label>
    <label className="block space-y-2 text-sm"><span>API Key</span><Input type="password" autoComplete="off" value={draft.apiKey} onChange={e => setDraft({ ...draft, apiKey: e.target.value })} /></label>
    <label className="flex items-center justify-between text-sm">在此设备记住 API Key<Switch checked={draft.keyStorage === 'local'} onCheckedChange={value => setDraft({ ...draft, keyStorage: value ? 'local' : 'session' })} /></label>
    <p className="text-xs leading-relaxed text-muted-foreground">{isDesktop() ? '开启后存入 Windows 凭据管理器；关闭后仅在本次运行期间保留。清空 Key 并保存可移除已记住的密钥。' : '关闭后仅保留在标签页会话中；开启后以明文保存在本机浏览器中。'}未填写密钥时使用演示模式。</p>
    <Button onClick={() => void save()}>{busy ? '正在保存…' : '保存 AI 配置'}</Button><p role="status" className="text-xs text-muted-foreground">{note}</p>
  </fieldset>
}

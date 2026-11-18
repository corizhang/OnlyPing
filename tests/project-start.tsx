// Presentation fixture only: no native file I/O, production project records or user paths.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import ProjectStart from '../src/components/ProjectStart'
import type { LibraryPreferences } from '../src/lib/workspace'
import ProjectVersionChoice, { type ProjectVersions } from '../src/components/ProjectVersionChoice'
import { DEFAULT_EXPORT_STYLE, DEFAULT_EXPORT_FOOTER, type Page } from '../src/types'
import '../src/index.css'
if (location.origin !== 'http://127.0.0.1:3011') throw Error('Use the isolated QA origin')
function thumb(label: string, color: string) {
  const canvas = document.createElement('canvas'); canvas.width = 180; canvas.height = 120
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#eef0f3'; ctx.fillRect(0, 0, 180, 120)
  ctx.fillStyle = '#fff'; ctx.fillRect(12, 12, 156, 96); ctx.fillStyle = '#30363d'; ctx.fillRect(12, 12, 156, 18)
  ctx.fillStyle = color; ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.strokeRect(30, 48, 70, 35); ctx.beginPath(); ctx.arc(132, 65, 10, 0, 7); ctx.fill()
  ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.fillText('1', 129, 69)
  ctx.fillStyle = '#59616d'; ctx.font = '10px sans-serif'; ctx.fillText(label, 30, 101)
  return canvas.toDataURL('image/jpeg')
}
const entries = ['账号开通操作指引', '产品功能说明', '常见问题处理', '安装与配置'].map((title, index) => ({ id: `fixture-${index}`, title, path: `D:\\示例项目\\${title}.json`, hash: 'fixture', pages: [6, 12, 4, 8][index], savedAt: Date.now(), accessedAt: Date.now() - index * 86400000, thumbnail: thumb('OnlyPing screenshot', ['#ef4444', '#2563eb', '#10b981', '#f59e0b'][index]), available: index !== 3 }))
const fixtureTime = Date.now()
export default function Fixture() {
  const [message, setMessage] = useState('独立首页样式验收 · 文件操作为模拟，不访问用户项目')
  const [versions, setVersions] = useState<ProjectVersions | null>(null)
  const [search, setSearch] = useState('')
  const [preferences, setPreferences] = useState<LibraryPreferences>({ pinned: [], hidden: [] })
  const recoveries = [{ key: 'project:fixture-0', title: '账号开通操作指引（补充说明）', pages: 7, savedAt: fixtureTime + 1000 }, { key: 'project:only-draft', title: '尚未完成的操作指引', pages: 3, savedAt: fixtureTime + 2000 }]
  const page: Page = { id: 'sample', name: '截图', image: entries[0].thumbnail, width: 180, height: 120, notes: '', annotations: [] }
  return <div className="ps-workspace"><ProjectStart info={{ directory: 'D:\\文档\\OnlyPing\\Projects', projects: entries, preferences }} search={search} onSearchChange={setSearch} onLibraryChange={async (action, id) => {
    setPreferences(current => ({ pinned: action === 'pin' && id ? [...new Set([...current.pinned, id])] : action === 'unpin' || action === 'hide' ? current.pinned.filter(value => value !== id) : current.pinned, hidden: action === 'hide' && id ? [...new Set([...current.hidden, id])] : action === 'restore-all' ? [] : current.hidden }))
    setMessage(`已更新示例列表：${action}`)
  }} recoveries={recoveries} onDraft={entry => setMessage(`已请求恢复草稿：${entry.title}`)} loading={false} error="" busy={false} onNew={() => setMessage('已请求新建项目')} onOpen={() => setMessage('已请求打开项目')} onDirectory={() => setMessage('已请求设置默认目录')} onRecent={entry => {
    const data = { schemaVersion: 1 as const, projectId: entry.id, title: entry.title, pages: Array.from({ length: entry.pages }, (_, index) => ({ ...page, id: `sample-${index}` })), exportStyle: DEFAULT_EXPORT_STYLE, exportFooter: DEFAULT_EXPORT_FOOTER }
    setVersions({ entry, file: entry.available ? data : null, source: entry.available ? { path: entry.path, hash: entry.hash, file: new File([JSON.stringify(data)], 'sample.json') } : null, recovery: { ...data, title: '账号开通操作指引（补充说明）', pages: [...data.pages, { ...page, id: 'added' }], savedAt: Date.now() }, message: '项目文件与本机恢复存档内容不同，请选择要继续编辑的版本。' })
  }} onRecovery={() => setMessage('已请求恢复存档')} onContinue={() => setMessage('已请求继续工作区')} onRetry={() => {}} />{versions && <ProjectVersionChoice versions={versions} busy={false} onChoose={choice => { setMessage(`已选择版本：${choice}${versions.location && choice !== 'copy' ? ' · 已确认示例新关联' : ''}`); setVersions(null) }} onClose={() => setVersions(null)} onLocate={() => {
    const file = versions.file ?? versions.recovery!
    const path = `D:\\迁移后的示例项目\\${versions.entry.title}.json`
    setVersions({ ...versions, location: versions.location ?? { path: versions.entry.path, hash: versions.entry.hash }, entry: { ...versions.entry, path, available: true }, file, source: { path, hash: 'fixture-new-hash', file: new File([JSON.stringify(file)], 'sample.json') }, message: '已找到同一项目的新位置。请核对文件与本机恢复存档，选择要继续编辑的版本。' })
  }} />}<p role="status" className="fixed bottom-3 left-8 z-50 text-xs text-[#aaa]">{message}</p></div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)

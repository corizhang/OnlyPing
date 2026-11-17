// Presentation fixture only: no native file I/O, production project records or user paths.
import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import ProjectStart from '../src/components/ProjectStart'
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
export default function Fixture() {
  const [message, setMessage] = useState('独立首页样式验收 · 文件操作为模拟，不访问用户项目')
  return <div className="ps-workspace"><ProjectStart info={{ directory: 'D:\\文档\\OnlyPing\\Projects', projects: entries }} loading={false} error="" busy={false} onNew={() => setMessage('已请求新建项目')} onOpen={() => setMessage('已请求打开项目')} onDirectory={() => setMessage('已请求设置默认目录')} onRecent={entry => setMessage(`已请求打开：${entry.title}`)} onRecovery={() => setMessage('已请求恢复存档')} onContinue={() => setMessage('已请求继续工作区')} onRetry={() => {}} /><p role="status" className="fixed bottom-3 left-8 z-50 text-xs text-[#aaa]">{message}</p></div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)

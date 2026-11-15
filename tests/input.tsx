// Isolated synthetic-event acceptance harness. This is not native OS IME QA.
// Run on a dedicated port: it seeds two named QA projects on that origin.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Home from '../src/pages/Home'
import { idbGet, idbSet, readLocalProject } from '../src/lib/db'
import { DEFAULT_EXPORT_FOOTER, DEFAULT_EXPORT_STYLE } from '../src/types'
import '../src/index.css'

const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600
const context = canvas.getContext('2d')!; context.fillStyle = '#fff'; context.fillRect(0, 0, 800, 600)
const pages = [1, 2].map(n => ({ id: `input-step-${n}`, name: `输入步骤${n}`, notes: `步骤${n}原文`, width: 800, height: 600, image: canvas.toDataURL(), annotations: [] }))
for (const id of ['B', 'A']) {
  await idbGet(`project:qa-input-${id}`)
  await idbSet({ schemaVersion: 1, projectId: `qa-input-${id}`, title: `QA输入项目${id}`, pages, exportStyle: DEFAULT_EXPORT_STYLE, exportFooter: DEFAULT_EXPORT_FOOTER })
}
createRoot(document.getElementById('root')!).render(<StrictMode><Home /></StrictMode>)
const panel = document.createElement('aside')
panel.style.cssText = 'position:fixed;bottom:50px;left:60px;z-index:9999;width:460px;background:#181818;color:white;padding:12px;font:13px/1.6 sans-serif;border:1px solid #777'
panel.innerHTML = '<p>隔离模拟事件验收，非操作系统输入法测试</p><button>运行组合输入场景</button><pre style="white-space:pre-wrap" aria-live="polite"></pre>'
document.body.appendChild(panel)
const button = panel.querySelector('button')!, output = panel.querySelector('pre')!
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(condition: () => boolean, label: string) {
  const deadline = performance.now() + 3000
  while (!condition()) { if (performance.now() > deadline) throw new Error(`等待超时：${label}`); await wait(16) }
}
const notes = () => document.querySelector<HTMLElement>('[aria-label="步骤说明富文本编辑区"]')!
const step = (n: number) => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="项目步骤"] button')].find(b => b.textContent?.includes(`输入步骤${n}`))!
const assert = (condition: unknown, text: string) => { if (!condition) throw new Error(text); output.textContent += `PASS ${text}\n` }
function compose(element: HTMLElement, value: string) {
  element.focus()
  element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
  if (element instanceof HTMLTextAreaElement) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value)
  else element.innerHTML = `<p>${value}</p>`
  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertCompositionText', isComposing: true }))
}
function end(element: HTMLElement, value: string) {
  element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: value }))
  element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText', isComposing: false }))
}
async function library() {
  const trigger = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === '项目')!
  trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse', isPrimary: true }))
  await wait(50)
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(e => e.textContent?.includes('本地项目与历史版本'))!
  if (!item) throw new Error('项目菜单未打开')
  item.click(); await until(() => !!document.querySelector('[role="dialog"]'), '本地项目列表')
}
async function openProject(title: string) {
  await library()
  const entry = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent?.includes(title) && b.textContent.includes('打开项目'))!
  if (!entry) throw new Error(`项目未找到：${title}`)
  entry.click(); await until(() => !document.querySelector('[role="dialog"]') && document.querySelector<HTMLInputElement>('[aria-label="项目标题"]')?.value === title, title)
}
button.onclick = async () => {
  button.disabled = true; output.textContent = ''
  try {
    await until(() => !!step(1) && !!notes(), '编辑器初始化')
    step(1).click(); await wait(80)
    const first = notes(); compose(first, '中文组合输入甲')
    step(2).click(); setTimeout(() => end(first, '中文组合输入甲'), 20)
    await until(() => notes()?.textContent === '步骤2原文', '切页后第二页内容')
    assert(notes().textContent === '步骤2原文', '切页后第二页未被组合输入覆盖')
    step(1).click(); await until(() => notes()?.textContent === '中文组合输入甲', '第一页终稿')
    assert(notes().textContent === '中文组合输入甲', '第一页保留组合输入终稿')

    const source = notes(); compose(source, '切项目前最终中文')
    setTimeout(() => end(source, '切项目前最终中文'), 70)
    await openProject('QA输入项目B')
    await until(() => notes()?.textContent === '步骤1原文', '项目B说明')
    assert(notes().textContent === '步骤1原文', '切项目后目标项目内容未串入')
    const saved = await readLocalProject({ key: 'project:qa-input-A', title: '', savedAt: 0, pages: 2 })
    assert(saved?.pages[0].notes === '切项目前最终中文', '源项目持久存档含最后中文字符')
    await openProject('QA输入项目A')
    await until(() => notes()?.textContent === '切项目前最终中文', '项目A终稿')
    assert(notes().textContent === '切项目前最终中文', '重新打开源项目恢复终稿')

    document.querySelector<HTMLButtonElement>('[aria-label="文字"]')!.click(); await wait(50)
    const svg = document.querySelector<SVGElement>('svg[viewBox="0 0 800 600"]')!, bounds = svg.getBoundingClientRect()
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: bounds.left + 50, clientY: bounds.top + 50 }))
    await until(() => !!document.querySelector('[aria-label="标注文字编辑区"]'), '标注输入框')
    const textarea = document.querySelector<HTMLTextAreaElement>('[aria-label="标注文字编辑区"]')!
    compose(textarea, '中文标注终稿')
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', isComposing: true, keyCode: 229 }))
    assert(textarea.isConnected, '组合输入 Esc 不取消标注编辑')
    textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', ctrlKey: true, isComposing: true, keyCode: 229 }))
    await wait(20)
    assert(textarea.isConnected, '组合输入 Ctrl+Enter 不提前提交')
    step(2).click(); setTimeout(() => end(textarea, '中文标注终稿'), 20)
    await until(() => step(2)?.getAttribute('aria-current') === 'page', '标注提交后切页')
    // Opening the library forces a real save, using the latest project refs.
    await library()
    const annotated = await readLocalProject({ key: 'project:qa-input-A', title: '', savedAt: 0, pages: 2 })
    assert(annotated?.pages[0].annotations.some(a => a.kind === 'text' && a.text === '中文标注终稿'), '标注终稿提交到原步骤并持久保存')
    assert(!annotated?.pages[1].annotations.length, '目标步骤没有收到旧标注')
    output.textContent += '全部模拟场景通过；仍需真实中文 IME 验证。'
  } catch (error) { output.textContent += `FAIL ${error instanceof Error ? error.message : String(error)}` }
  finally { button.disabled = false }
}

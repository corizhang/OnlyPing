// Use only on 127.0.0.1:3011. Synthetic project; browser saves are intercepted for verification.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import JSZip from 'jszip'
import Home from '../src/pages/Home'
import { idbGet, idbSet } from '../src/lib/db'
import { DEFAULT_EXPORT_FOOTER, DEFAULT_EXPORT_STYLE, type Page } from '../src/types'
import '../src/index.css'

if (location.origin !== 'http://127.0.0.1:3011') throw Error('Run this QA harness only on its isolated origin')
const baseImage = (width: number, height: number, color: string) => {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, width, height)
  return canvas.toDataURL('image/png')
}
const pages: Page[] = [
  { id: 'image-qa-1', name: '重复/名称.png', width: 320, height: 180, image: baseImage(320, 180, '#f1f5f9'), notes: 'NOTES_MUST_NOT_RENDER', annotations: [{ id: 'box', kind: 'box', x: 40, y: 40, w: 80, h: 60, color: '#ff0000' }, { id: 'n1', kind: 'number', x: 180, y: 70, r: 16 }, { id: 'hidden-n', kind: 'number', x: 230, y: 70, hidden: true }] },
  { id: 'image-qa-2', name: '重复/名称.png', width: 240, height: 140, image: baseImage(240, 140, '#dbeafe'), notes: '', annotations: [{ id: 'n2', kind: 'number', x: 180, y: 70, r: 16 }], orig: { width: 640, height: 360, image: baseImage(640, 360, '#000000'), annotations: [] } },
  { id: 'image-qa-3', name: '第三张', width: 300, height: 200, image: baseImage(300, 200, '#fde68a'), notes: 'NO FOOTER OR NOTES', notesRich: '<p>NO HTML</p>', annotations: [{ id: 'text', kind: 'text', x: 150, y: 30, text: 'MARK', color: '#0000ff', size: 22, background: false }, { id: 'callout', kind: 'callout', x: 30, y: 85, w: 150, h: 70, text: 'BUBBLE', color: '#7c3aed' }, { id: 'mask', kind: 'mosaic', x: 0, y: 0, w: 10, h: 10, hidden: true }] },
]
await idbGet('project:qa-image-export')
await idbSet({ schemaVersion: 1, projectId: 'qa-image-export', title: 'DOC_TITLE_MUST_NOT_RENDER', pages, exportStyle: DEFAULT_EXPORT_STYLE, exportFooter: { ...DEFAULT_EXPORT_FOOTER, org: 'FOOTER_MUST_NOT_RENDER' } })
const captured: { filename: string; blob: Blob; saved: Promise<void> }[] = []
const urls = new Map<string, Blob>()
const createURL = URL.createObjectURL.bind(URL), revokeURL = URL.revokeObjectURL.bind(URL)
URL.createObjectURL = blob => { const url = createURL(blob); if (blob instanceof Blob) urls.set(url, blob); return url }
URL.revokeObjectURL = url => { urls.delete(url); revokeURL(url) }
const anchorClick = HTMLAnchorElement.prototype.click
let artifact = ''
const post = async (name: string, blob: Blob) => {
  const response = await fetch(`http://127.0.0.1:3012/artifact/${name}`, { method: 'POST', body: blob })
  if (!response.ok) throw Error(`Artifact collector returned ${response.status}`)
}
HTMLAnchorElement.prototype.click = function () {
  if (this.download && urls.has(this.href)) {
    if (!artifact) throw Error('Unexpected QA download')
    const blob = urls.get(this.href)!, name = artifact; artifact = ''
    captured.push({ filename: this.download, blob, saved: post(name, blob) })
    return
  }
  anchorClick.call(this)
}
const confirms: string[] = []
window.confirm = message => { confirms.push(String(message)); return true }
createRoot(document.getElementById('root')!).render(<StrictMode><Home /></StrictMode>)
const panel = document.createElement('aside')
panel.style.cssText = 'position:fixed;left:60px;bottom:55px;z-index:9999;background:#181818;color:white;padding:12px;width:430px;font:12px/1.5 sans-serif;border:1px solid #777'
panel.innerHTML = '<p>独立合成项目验收：保存由测试捕获，不下载用户文件</p><button>运行图片导出验收</button><pre style="white-space:pre-wrap" aria-live="polite"></pre>'
document.body.appendChild(panel)
const trigger = panel.querySelector('button')!, output = panel.querySelector('pre')!
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 10000
  while (!check()) { if (performance.now() > deadline) throw Error(`Timeout: ${label}`); await wait(25) }
}
const find = (selector: string, text: string) => [...document.querySelectorAll<HTMLElement>(selector)].find(element => element.textContent?.trim() === text)
const click = (element: HTMLElement | undefined, label: string) => {
  if (!element) throw Error(`Missing ${label}`)
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }))
  element.click()
}
async function openMenu() { click(find('button', '导出'), 'export menu'); await until(() => !!find('[role=menuitem]', '当前页标注图（PNG）'), 'menu') }
async function openDialog() { await openMenu(); click([...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(e => e.textContent?.includes('导出标注图片…')), 'image dialog'); await until(() => !!find('[role=dialog] h2', '导出标注图片'), 'image dialog') }
async function download(index: number) { await until(() => captured.length > index, `output ${index}`); await captured[index].saved; await until(() => !!find('button', '导出'), 'export task finished') }
trigger.onclick = async () => {
  trigger.disabled = true; output.textContent = 'Running…'
  const passed: string[] = []
  const assert = (condition: boolean, label: string) => { if (!condition) throw Error(label); passed.push(label); output.textContent = passed.join('\n') }
  try {
    await until(() => !!document.querySelector('[aria-current=page]'), 'initial page')
    const selected = document.querySelector('[aria-current=page]')!.getAttribute('title')
    artifact = 'single.png'; await openMenu(); click(find('[role=menuitem]', '当前页标注图（PNG）'), 'current export'); await download(0)
    assert(captured[0].blob.type === 'image/png', 'current image is PNG')
    await openDialog()
    click(document.querySelectorAll<HTMLInputElement>('input[name=image-export-scope]')[1], 'specified scope')
    await until(() => !!find('button', '清空选择'), 'selection list')
    click(find('button', '清空选择'), 'clear selection'); await wait(50)
    click(document.querySelector<HTMLElement>('[aria-label="导出第 1 张 重复/名称.png"]')!, 'first checkbox')
    click(document.querySelector<HTMLElement>('[aria-label="导出第 3 张 第三张"]')!, 'third checkbox')
    await until(() => !!find('button', '导出 2 张（ZIP）'), 'two images selected')
    artifact = 'specified.zip'; click(find('button', '导出 2 张（ZIP）'), 'specified export'); await download(1)
    const specified = await JSZip.loadAsync(await captured[1].blob.arrayBuffer(), { checkCRC32: true })
    assert(Object.keys(specified.files).join('|') === '001-重复_名称.png|003-第三张.png', 'specified ZIP retains project order and safe names')
    await openDialog(); click(document.querySelectorAll<HTMLInputElement>('input[name=image-export-scope]')[2], 'all scope')
    await until(() => !!find('button', '导出 3 张（ZIP）'), 'all selected')
    artifact = 'all.zip'; click(find('button', '导出 3 张（ZIP）'), 'all export'); await download(2)
    const all = await JSZip.loadAsync(await captured[2].blob.arrayBuffer(), { checkCRC32: true })
    assert(Object.keys(all.files).length === 3, 'all ZIP contains three complete PNGs')
    assert(confirms.length === 2 && confirms.every(message => message.includes('隐藏的打码') && !message.includes('缺少说明')), 'privacy warnings retained; missing step notes do not block images')
    await openDialog(); click(find('[role=dialog] button', '取消'), 'cancel export dialog'); await wait(100)
    assert(captured.length === 3, 'cancel selection produces no file')
    artifact = 'row.png'; click(document.querySelector<HTMLElement>('[aria-label="导出第 2 张标注图片"]')!, 'export other row'); await download(3)
    assert(document.querySelector('[aria-current=page]')?.getAttribute('title') === selected, 'row export preserves active canvas selection')
    assert(captured[3].filename.startsWith('002-'), 'row output refers to requested image')
    await post('report.json', new Blob([JSON.stringify({ passed, confirms, files: captured.map(item => ({ name: item.filename, type: item.blob.type, bytes: item.blob.size })) }, null, 2)], { type: 'application/json' }))
    output.textContent = `PASS ${passed.length}\n${passed.join('\n')}`
  } catch (error) { output.textContent = `FAIL\n${passed.join('\n')}\n${error instanceof Error ? error.message : String(error)}` }
  finally { trigger.disabled = false }
}

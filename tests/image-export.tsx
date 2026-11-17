// Use only on 127.0.0.1:3011. Synthetic project; browser saves are intercepted for verification.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import JSZip from 'jszip'
import Home from '../src/pages/Home'
import { renderAnnotatedImage } from '../src/lib/export-annotated-images'
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
panel.style.cssText = 'position:fixed;left:60px;bottom:55px;z-index:9999;background:#181818;color:white;padding:12px;width:260px;max-height:180px;overflow:auto;font:11px/1.5 sans-serif;border:1px solid #777'
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
async function openDialog(reset = true) {
  await openMenu(); click([...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(e => e.textContent?.includes('导出标注图片…')), 'image dialog'); await until(() => !!find('[role=dialog] h2', '导出标注图片'), 'image dialog')
  if (reset) { click(find('[role=dialog] button', '恢复默认'), 'reset test settings'); await wait(50) }
}
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
    assert(document.querySelector<HTMLOptionElement>('[aria-label="保存方式"] option[value="folder"]')?.disabled === true, 'web folder export is disabled while PNG and ZIP remain available')
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
    const choose = async (label: string, value: string) => {
      const select = document.querySelector<HTMLSelectElement>(label)!
      select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); await wait(50)
    }
    await openDialog(); await choose('#image-export-size', 'percent')
    artifact = 'half.png'; click(find('button', '导出 1 张（PNG）'), 'half export'); await download(4)
    const half = await createImageBitmap(captured[4].blob)
    assert(half.width === 160 && half.height === 90, 'percentage export halves real PNG dimensions'); half.close()
    await openDialog(); await choose('#image-export-size', 'maxWidth')
    const input = document.querySelector<HTMLInputElement>('[role=dialog] input[type=number]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '160')
    input.dispatchEvent(new Event('input', { bubbles: true })); await wait(50)
    click(document.querySelectorAll<HTMLInputElement>('input[name=image-export-scope]')[2], 'limited all scope')
    artifact = 'limited.zip'; click(find('button', '导出 3 张（ZIP）'), 'limited export'); await download(5)
    const limited = await JSZip.loadAsync(await captured[5].blob.arrayBuffer(), { checkCRC32: true })
    for (const [index, entry] of Object.values(limited.files).entries()) {
      const bitmap = await createImageBitmap(await entry.async('blob'))
      if (bitmap.width !== 160 || bitmap.height !== [90, 93, 107][index]) throw Error('max width dimensions mismatch')
      bitmap.close()
    }
    assert(true, 'maximum width applies to each ZIP image with proportional heights')
    await openDialog(); await choose('[aria-label="标注序号"]', 'per-image')
    click(document.querySelectorAll<HTMLInputElement>('input[name=image-export-scope]')[1], 'restart specified scope')
    await until(() => !!find('button', '清空选择'), 'restart list')
    click(find('button', '清空选择'), 'restart clear'); await wait(50)
    click(document.querySelector<HTMLElement>('[aria-label="导出第 2 张 重复/名称.png"]')!, 'restart second')
    await until(() => !!find('button', '导出 1 张（PNG）'), 'restart image selected')
    artifact = 'restart.png'; click(find('button', '导出 1 张（PNG）'), 'restart export'); await download(6)
    assert(captured[6].blob.size > 0 && captured[6].filename.startsWith('002-'), 'restart numbering preserves original filename order')
    await openDialog(); await choose('#image-export-format', 'jpeg'); await choose('#image-export-size', 'percent')
    artifact = 'single.jpg'; click(find('button', '导出 1 张（JPEG）'), 'JPEG export'); await download(7)
    const jpg = await createImageBitmap(captured[7].blob)
    assert(captured[7].blob.type === 'image/jpeg' && captured[7].filename.endsWith('.jpg') && jpg.width === 160 && jpg.height === 90, 'JPEG download has correct MIME, filename and scaled dimensions'); jpg.close()
    await openDialog(); await choose('#image-export-format', 'jpeg')
    click(document.querySelectorAll<HTMLInputElement>('input[name=image-export-scope]')[2], 'JPEG all scope')
    await until(() => !!find('button', '导出 3 张（ZIP）'), 'JPEG all selected')
    artifact = 'jpeg.zip'; click(find('button', '导出 3 张（ZIP）'), 'JPEG ZIP'); await download(8)
    const jpegZip = await JSZip.loadAsync(await captured[8].blob.arrayBuffer(), { checkCRC32: true })
    for (const [index, entry] of Object.values(jpegZip.files).entries()) {
      const bytes = await entry.async('uint8array')
      const bitmap = await createImageBitmap(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/jpeg' }))
      if (!entry.name.endsWith('.jpg') || bytes[0] !== 255 || bytes[1] !== 216 || bitmap.width !== pages[index].width || bitmap.height !== pages[index].height) throw Error('JPEG ZIP mismatch')
      bitmap.close()
    }
    assert(Object.keys(jpegZip.files).length === 3, 'JPEG ZIP contains complete decodable jpg entries')
    const resultPanel = document.querySelector<HTMLElement>('[aria-label="图片导出结果"]')!
    assert(/已生成\s*3\s*\/\s*3/.test(resultPanel.textContent ?? '') && resultPanel.textContent!.includes('浏览器下载记录'), 'result panel distinguishes generated download from confirmed disk save')
    click(document.querySelector<HTMLElement>('[aria-label="关闭图片导出结果"]')!, 'close result'); await wait(50)
    await openMenu(); click(find('[role=menuitem]', '最近图片导出结果'), 'reopen last result'); await wait(50)
    assert(!!document.querySelector('[aria-label="图片导出结果"]'), 'last export report can be reopened')
    await openDialog(false)
    assert(document.querySelector<HTMLSelectElement>('#image-export-format')?.value === 'jpeg', 'confirmed export preferences restored on reopen')
    click(find('[role=dialog] button', '取消'), 'cancel preference inspection'); await wait(50)
    const transparent = { ...pages[0], image: baseImage(320, 180, 'rgba(0,0,0,0)') }
    const white = await renderAnnotatedImage(transparent, 0, {}, undefined, { format: 'jpeg', quality: 90 })
    const whiteBitmap = await createImageBitmap(white), sample = document.createElement('canvas'); sample.width = 320; sample.height = 180
    const context = sample.getContext('2d')!; context.drawImage(whiteBitmap, 0, 0); whiteBitmap.close()
    const pixel = context.getImageData(0, 0, 1, 1).data
    assert(pixel[0] > 250 && pixel[1] > 250 && pixel[2] > 250 && pixel[3] === 255, 'JPEG transparent area is white and opaque'); await post('white.jpg', white)
    const low = await renderAnnotatedImage(pages[0], 0, {}, undefined, { format: 'jpeg', quality: 10 })
    const high = await renderAnnotatedImage(pages[0], 0, {}, undefined, { format: 'jpeg', quality: 95 })
    assert(low.size < high.size, 'JPEG lower quality reduces fixture file size'); await post('quality-low.jpg', low); await post('quality-high.jpg', high)
    await openDialog(); await choose('#image-export-format', 'jpeg'); await choose('#image-export-size', 'percent')
    click(document.querySelectorAll<HTMLInputElement>('input[name=image-export-scope]')[2], 'preview all scope'); await wait(50)
    click(find('button', '预览 JPEG 压缩效果'), 'compression preview')
    await until(() => !!find('[role=dialog] h2', 'JPEG 压缩预览'), 'compression dialog')
    await choose('[aria-label="预览样张"]', 'image-qa-2')
    await until(() => !!document.querySelector('img[alt="JPEG 压缩样张"]'), 'second preview ready')
    const previewImage = document.querySelector<HTMLImageElement>('img[alt="JPEG 压缩样张"]')!
    const firstPreviewUrl = previewImage.src, firstReferenceUrl = document.querySelector<HTMLImageElement>('img[alt="PNG 无损参考样张"]')!.src
    const previewBlob = urls.get(firstPreviewUrl)!, referenceBlob = urls.get(firstReferenceUrl)!
    const direct = await renderAnnotatedImage(pages[1], 1, {}, { width: 120, height: 70 }, { format: 'jpeg', quality: 90 })
    const previewBytes = new Uint8Array(await previewBlob.arrayBuffer()), directBytes = new Uint8Array(await direct.arrayBuffer())
    const previewBitmap = await createImageBitmap(previewBlob)
    assert(previewBitmap.width === 120 && previewBitmap.height === 70 && previewBytes.length === directBytes.length && previewBytes.every((value, index) => value === directBytes[index]), 'preview uses selected sample, project numbering and exact export JPEG bytes'); previewBitmap.close()
    await post('preview.jpg', previewBlob); await post('preview.png', referenceBlob)
    const previewQuality = document.querySelector<HTMLInputElement>('[aria-label="预览 JPEG 质量"]')!
    const setQuality = async (value: string) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(previewQuality, value); previewQuality.dispatchEvent(new Event('input', { bubbles: true })); await wait(50) }
    await setQuality('10')
    await until(() => { const next = document.querySelector<HTMLImageElement>('img[alt="JPEG 压缩样张"]'); return !!next && next.src !== firstPreviewUrl }, 'new quality preview')
    assert(!urls.has(firstPreviewUrl) && !urls.has(firstReferenceUrl), 'quality changes revoke previous preview URLs')
    await setQuality('0')
    assert(!document.querySelector('img[alt="JPEG 压缩样张"]') && !!find('[role=dialog] [role=alert]', 'JPEG 质量需为 1–100 的整数重试预览'), 'invalid quality clears stale preview and reports validation error')
    await setQuality('85'); await until(() => !!document.querySelector('img[alt="JPEG 压缩样张"]'), 'valid preview restored')
    const lastPreviewUrl = document.querySelector<HTMLImageElement>('img[alt="JPEG 压缩样张"]')!.src
    click(find('button', '返回导出设置'), 'return settings'); await wait(50)
    assert(!urls.has(lastPreviewUrl) && document.querySelector<HTMLInputElement>('[aria-label="JPEG 质量"]')?.value === '85', 'closing preview releases URLs and keeps chosen export quality')
    click(find('[role=dialog] button', '取消'), 'cancel preview settings'); await wait(50)
    assert(captured.length === 9, 'preview does not create downloads or write exported files')
    await post('report.json', new Blob([JSON.stringify({ passed, confirms, files: captured.map(item => ({ name: item.filename, type: item.blob.type, bytes: item.blob.size })) }, null, 2)], { type: 'application/json' }))
    output.textContent = `PASS ${passed.length}\n${passed.join('\n')}`
  } catch (error) { output.textContent = `FAIL\n${passed.join('\n')}\n${error instanceof Error ? error.message : String(error)}` }
  finally { trigger.disabled = false }
}

import JSZip from 'jszip'
import { renderDocument } from '../src/lib/export-layout'
import { exportDocx } from '../src/lib/export-word'
import { validateAutosave, idbGet, idbSet } from '../src/lib/db'
import { DEFAULT_EXPORT_STYLE, DEFAULT_EXPORT_FOOTER, type Page, type ExportStyle } from '../src/types'
import { DEFAULT_DOCUMENT_HEADER, documentRows } from '../src/lib/document-layout'

if (location.origin !== 'http://127.0.0.1:3011') throw Error('Only run on isolated QA origin')
const result = document.getElementById('result')!, preview = document.getElementById('preview')!
const assert = (value: unknown, message: string) => { if (!value) throw Error(message); result.textContent += `PASS ${message}\n` }
function image(color: string, width = 200, height = 300) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = color; ctx.fillRect(0, 0, width, height)
  return canvas.toDataURL()
}
const pages: Page[] = Array.from({ length: 5 }, (_, i) => ({ id: `layout-${i}`, name: `图 ${i + 1}`, image: image(['#ff0000', '#00aa00', '#0000ff'][i % 3]), width: 200, height: 300, annotations: [], notes: i === 0 ? '这段较长的说明用于验证同一行的所有图片顶部对齐。'.repeat(5) : `短说明 ${i + 1}` }))
const urls = new Map<string, Blob>(), downloads: Blob[] = []
const originalCreate = URL.createObjectURL.bind(URL), originalRevoke = URL.revokeObjectURL.bind(URL), originalClick = HTMLAnchorElement.prototype.click
URL.createObjectURL = blob => { const url = originalCreate(blob); if (blob instanceof Blob) urls.set(url, blob); return url }
URL.revokeObjectURL = url => { urls.delete(url); originalRevoke(url) }
HTMLAnchorElement.prototype.click = function () { if (this.download && urls.has(this.href)) { downloads.push(urls.get(this.href)!); return } originalClick.call(this) }
document.getElementById('run')!.addEventListener('click', async () => {
  const button = document.getElementById('run') as HTMLButtonElement
  button.disabled = true; result.textContent = ''; preview.replaceChildren()
  try {
    const header = { ...DEFAULT_DOCUMENT_HEADER, subtitle: '副标题测试', background: 'color' as const, color: '#3c6e9c', textColor: '#ffffff', logo: image('#ffcc00', 180, 60) }
    const project = { projectId: 'qa-document-layout', title: '排版测试', pages, exportStyle: { ...DEFAULT_EXPORT_STYLE, layout: 'three' as const, header }, exportFooter: DEFAULT_EXPORT_FOOTER }
    const parsed = validateAutosave(project)
    assert(parsed?.exportStyle.header?.logo === header.logo && parsed.exportStyle.layout === 'three', '头部素材与布局通过项目校验')
    await idbGet('project:qa-document-layout'); await idbSet(project)
    const restored = await idbGet('project:qa-document-layout')
    assert(restored?.exportStyle.header?.subtitle === header.subtitle && restored.exportStyle.header.logo === header.logo, '隔离存档往返保留副标题与素材')
    assert(validateAutosave({ ...project, exportStyle: { ...project.exportStyle, textWidth: 70 } }) === null, '拒绝非法图文比例')
    assert(validateAutosave({ ...project, exportStyle: { ...project.exportStyle, header: { ...header, logo: 'https://invalid.test/logo.png' } } }) === null, '拒绝外部地址素材')
    assert(documentRows(pages, 'three').map(row => row.length).join() === '3,2', '奇数末行保留源顺序')
    for (const layout of ['top', 'left', 'right', 'two', 'three', 'shared'] as const) {
      const style: ExportStyle = { ...DEFAULT_EXPORT_STYLE, layout, header }
      let inspected = false
      await renderDocument('排版测试', pages, style, { ...DEFAULT_EXPORT_FOOTER, showDate: false }, 'long', 1, { onCanvas: canvas => {
        const root = document.querySelector<HTMLElement>('[aria-hidden="true"][style*="-10000px"]')!
        for (const section of root.querySelectorAll('section')) {
          const pictures = [...section.lastElementChild!.querySelectorAll('img')]
          if (pictures.length > 1) assert(pictures.every(img => Math.abs(img.getBoundingClientRect().top - pictures[0].getBoundingClientRect().top) < 0.1), `${layout} 同一行所有图片顶部对齐`)
          if (layout === 'left' || layout === 'right') {
            const copy = section.firstElementChild!, picture = section.lastElementChild!
            assert(layout === 'left' ? copy.getBoundingClientRect().left < picture.getBoundingClientRect().left : copy.getBoundingClientRect().left > picture.getBoundingClientRect().left, `${layout} 图文位置正确`)
          }
        }
        if (!inspected && layout === 'three') {
          const sample = document.createElement('img'); sample.src = canvas.toDataURL(); sample.style.cssText = 'display:block;max-width:840px;width:100%;border:1px solid #ccc'; preview.appendChild(sample)
          const pixel = canvas.getContext('2d')!.getImageData(50, 50, 1, 1).data
          assert(pixel[0] === 60 && pixel[1] === 110 && pixel[2] === 156, '头部背景色进入真实输出像素')
        }
        inspected = true
      } })
      assert(inspected, `${layout} 长图完成`)
      const before = downloads.length
      await exportDocx('排版测试', pages, style, DEFAULT_EXPORT_FOOTER, 1)
      const zip = await JSZip.loadAsync(downloads[before])
      const xml = await zip.file('word/document.xml')!.async('string')
      assert(xml.includes('排版测试') || xml.includes('<w:drawing>'), `${layout} Word 已打包头部与正文`)
      if (layout === 'two' || layout === 'three') {
        const doc = new DOMParser().parseFromString(xml, 'application/xml')
        const table = doc.getElementsByTagName('w:tbl')[0]
        const rows = table.getElementsByTagName('w:tr')
        assert(rows.length === 2 && !rows[0].getElementsByTagName('w:drawing').length && rows[1].getElementsByTagName('w:drawing').length === (layout === 'two' ? 2 : 3), `${layout} Word 使用独立说明行和图片行保证顶部对齐`)
      }
    }
    for (const stepHeading of ['text', 'circle', 'badge'] as const) {
      const style = { ...DEFAULT_EXPORT_STYLE, layout: 'two' as const, stepHeading, header: { ...header, height: 240, subtitle: '较长副标题的完整显示测试。'.repeat(15) } }
      let inspected = false
      await renderDocument('较长主标题完整显示测试'.repeat(5), pages.slice(0, 2), style, DEFAULT_EXPORT_FOOTER, 'long', 1, { onCanvas: canvas => {
        const root = document.querySelector<HTMLElement>('[aria-hidden="true"][style*="-10000px"]')!
        const cover = root.querySelector('header')!, title = cover.querySelector('h1')!, subtitle = cover.querySelector('p')!
        assert(cover.getBoundingClientRect().height >= 240 && title.getBoundingClientRect().top >= cover.getBoundingClientRect().top && subtitle.getBoundingClientRect().bottom <= cover.getBoundingClientRect().bottom, `${stepHeading} 长标题和副标题完整包含在自动撑开的头部内`)
        const first = root.querySelector('h2')!
        assert(first.querySelectorAll('img').length === (stepHeading === 'text' ? 0 : 1), `${stepHeading} 编号样式已进入真实渲染`)
        const images = [...root.querySelector('section')!.lastElementChild!.querySelectorAll('img')]
        assert(images.every(img => img.getBoundingClientRect().top === images[0].getBoundingClientRect().top), `${stepHeading} 编号装饰不破坏多列图片对齐`)
        if (stepHeading === 'circle') { const sample = document.createElement('img'); sample.src = canvas.toDataURL(); sample.style.cssText = 'width:100%;max-width:840px;display:block;border:1px solid #ccc'; preview.prepend(sample) }
        inspected = true
      } })
      assert(inspected, `${stepHeading} 编号输出完成`)
      const before = downloads.length
      await exportDocx('编号测试', pages.slice(0, 2), style, DEFAULT_EXPORT_FOOTER, 1)
      const zip = await JSZip.loadAsync(downloads[before]), xml = await zip.file('word/document.xml')!.async('string')
      const doc = new DOMParser().parseFromString(xml, 'application/xml'), row = doc.getElementsByTagName('w:tr')[0]
      assert(row.getElementsByTagName('w:drawing').length === (stepHeading === 'text' ? 0 : 2), `${stepHeading} Word 保留编号装饰`)
    }
    let pdfPages = 0
    const plainBefore = downloads.length
    await exportDocx('白底头部高度', pages.slice(0, 1), { ...DEFAULT_EXPORT_STYLE, header: { ...header, background: 'plain', logo: undefined, height: 300 } }, DEFAULT_EXPORT_FOOTER, 1)
    const plainZip = await JSZip.loadAsync(downloads[plainBefore]), plainXml = await plainZip.file('word/document.xml')!.async('string')
    assert(plainXml.includes('w:val="4500"') && plainXml.includes('w:hRule="atLeast"') && plainXml.includes('副标题测试'), 'Word 白底头部保留最小高度与可编辑副标题')
    await renderDocument('PDF 分页测试', pages, { ...DEFAULT_EXPORT_STYLE, layout: 'three', header: { ...header, background: 'image', image: image('#445566'), overlay: 0.4 } }, DEFAULT_EXPORT_FOOTER, 'pdf', 1, { onCanvas: canvas => { assert(canvas.width === 840 && canvas.height === 1188, 'PDF 输出固定 A4 画布'); pdfPages++ } })
    assert(pdfPages > 0, '图片背景头部与 PDF 分页完成')
    result.textContent += '全部通过；仅为隔离浏览器/文档结构验收，不代表原生保存或 Word 软件分页验收。'
  } catch (error) { result.textContent += `FAIL ${error instanceof Error ? error.stack : String(error)}` }
  finally { button.disabled = false }
})

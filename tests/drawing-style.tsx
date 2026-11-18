// Synthetic, isolated QA only. Exercises the real editor, parameter controls and export renderer.
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { useState } from 'react'
import CanvasEditor from '../src/components/CanvasEditor'
import AnnotationParameters from '../src/components/AnnotationParameters'
import { createAnnotation } from '../src/lib/tools'
import { renderAreaAnnotation } from '../src/lib/tools/area'
import { renderMarkAnnotation } from '../src/lib/tools/mark'
import { renderPageToCanvas } from '../src/lib/render'
import { DEFAULT_ANNOTATION_STYLE, type Annotation, type Page } from '../src/types'
import '../src/index.css'
if (location.origin !== 'http://127.0.0.1:3011') throw Error('Use isolated QA origin')
const base = document.createElement('canvas'); base.width = 920; base.height = 450
const ctx = base.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 920, 450)
ctx.fillStyle = '#64748b'; ctx.font = '14px sans-serif'
for (const [label, x, y] of [['仅边框', 30, 36], ['边框 + 填充 · 圆角 / 虚线', 330, 36], ['仅填充', 630, 36], ['仅边框', 30, 180], ['边框 + 填充', 330, 180], ['仅填充', 630, 180], ['标准箭头', 30, 328], ['强调箭头', 330, 328], ['原有箭头（兼容）', 630, 328]] as const) ctx.fillText(label, x, y)
const samples: Annotation[] = []
for (const kind of ['box', 'ellipse'] as const) for (let i = 0; i < 3; i++) {
  const a = createAnnotation(kind, 30 + i * 300, kind === 'box' ? 56 : 200, DEFAULT_ANNOTATION_STYLE)
  samples.push({ ...a, id: `${kind}-${i}`, w: 240, h: 86, color: i === 2 ? '#2563eb' : '#ef4444', style: { width: 3, fill: i === 0 ? 'none' : 'solid', fillOpacity: .18, strokeStyle: i === 2 ? 'none' : i === 1 && kind === 'box' ? 'dashed' : 'solid', radius: i === 1 && kind === 'box' ? 14 : 0 } } as Annotation)
}
for (const [i, arrowStyle] of (['standard', 'emphasis', 'legacy'] as const).entries()) samples.push({ id: `arrow-${i}`, kind: 'arrow', x1: 30 + i * 300, y1: 405, x2: 260 + i * 300, y2: 355, color: '#ef4444', width: 7, ...(arrowStyle === 'legacy' ? {} : { arrowStyle }) })
const initial: Page = { id: 'style-qa', name: '样式验收', image: base.toDataURL(), width: 920, height: 450, notes: '', annotations: samples }

async function parity(page: Page): Promise<string> {
  const exported = await renderPageToCanvas(page)
  const vectors = page.annotations.map(a => <g key={a.id}>{a.kind === 'box' || a.kind === 'ellipse' ? renderAreaAnnotation(a, false) : a.kind === 'arrow' ? renderMarkAnnotation(a, { selected: false, label: 1, handleR: 4 }) : null}</g>)
  const svg = renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" width={920} height={450}><image href={page.image} width={920} height={450} />{vectors}</svg>)
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const raster = document.createElement('canvas'); raster.width = 920; raster.height = 450
  try {
    const image = new Image(); image.src = url; await image.decode()
    const context = raster.getContext('2d')!; context.drawImage(image, 0, 0)
    const expected = context.getImageData(0, 0, 920, 450).data, actual = exported.getContext('2d')!.getImageData(0, 0, 920, 450).data
    let difference = 0, changed = 0
    for (let i = 0; i < expected.length; i += 4) { let delta = 0; for (let c = 0; c < 3; c++) delta += Math.abs(expected[i+c] - actual[i+c]); difference += delta; if (delta > 24) changed++ }
    const mean = difference / (920 * 450 * 3), fraction = changed / (920 * 450)
    if (mean > 1 || fraction > .01) throw Error(`SVG/Canvas mismatch: mean=${mean}, fraction=${fraction}`)
    return `PASS · SVG/Canvas ${page.annotations.length} 个样式 · 平均通道差 ${mean.toFixed(3)} · 差异像素 ${(fraction * 100).toFixed(3)}%`
  } finally { URL.revokeObjectURL(url); exported.width = 0; raster.width = 0 }
}
export default function Fixture() {
  const [page, setPage] = useState(initial), [ids, setIds] = useState<string[]>([]), [result, setResult] = useState('尚未校验')
  const selected = page.annotations.find(a => a.id === ids[0])
  return <main className="ps-workspace min-h-screen bg-[#252525] p-5 text-[#ddd]">
    <header className="mb-4 flex items-center justify-between"><div><h1 className="text-base font-medium">标注样式 · 第一批</h1><p className="mt-1 text-xs text-[#aaa]">真实编辑器与参数栏 · 合成数据，不访问用户项目</p></div><button className="rounded border border-white/20 px-3 py-2 text-xs" onClick={() => { void parity(page).then(setResult).catch(error => setResult(`FAIL · ${error.message}`)) }}>校验编辑与导出一致性</button></header>
    <div className="mb-4 flex min-h-11 items-center gap-3 overflow-x-auto border-y border-white/10 bg-[#323232] px-3 py-1 text-xs"><span className="shrink-0">{selected ? '当前标注' : '点击边框或填充区域选择标注'}</span>{selected && <AnnotationParameters annotation={selected} onChange={patch => setPage(current => ({ ...current, annotations: current.annotations.map(a => a.id === selected.id ? { ...a, ...patch } as Annotation : a) }))} />}</div>
    <div className="mx-auto w-fit shadow-xl"><CanvasEditor page={page} tool="select" color="#ef4444" zoom={1} numberStart={0} mosaicTile={20} numberR={20} textSize={26} strokeWidth={4} selectedId={ids[0] ?? null} selectedIds={ids} onSelectionChange={setIds} onSelect={id => setIds(id ? [id] : [])} onChange={annotations => setPage(current => ({ ...current, annotations }))} /></div>
    <div className="mx-auto mt-4 flex w-[920px] max-w-full items-center gap-2"><button className="rounded border border-white/20 px-3 py-2 text-xs" onClick={() => setIds(['box-1'])}>选择矩形</button><button className="rounded border border-white/20 px-3 py-2 text-xs" onClick={() => setIds(['ellipse-1'])}>选择椭圆</button><button className="rounded border border-white/20 px-3 py-2 text-xs" onClick={() => setIds(['arrow-0'])}>选择箭头</button><button className="rounded border border-white/20 px-3 py-2 text-xs" onClick={() => setIds([])}>取消选择</button><p role="status" className="ml-auto text-xs text-[#aaa]">{result}</p></div>
  </main>
}
const qaRoot = createRoot(document.getElementById('root')!)
qaRoot.render(<Fixture />)
import.meta.hot?.dispose(() => qaRoot.unmount())

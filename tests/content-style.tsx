import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { useState } from 'react'
import CanvasEditor from '../src/components/CanvasEditor'
import AnnotationParameters from '../src/components/AnnotationParameters'
import { renderContentAnnotation } from '../src/lib/tools/content'
import { renderMarkAnnotation } from '../src/lib/tools/mark'
import { renderAreaAnnotation } from '../src/lib/tools/area'
import { renderPageToCanvas } from '../src/lib/render'
import type { Annotation, Page } from '../src/types'
import '../src/index.css'
if (location.origin !== 'http://127.0.0.1:3011') throw Error('Use isolated QA origin')
const base = document.createElement('canvas'); base.width = 920; base.height = 440
const ctx = base.getContext('2d')!; ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, 0, 920, 440); ctx.font = '14px sans-serif'; ctx.fillStyle = '#64748b'
for (const [label,x,y] of [['普通文字 · 无描边',30,30],['描边文字',330,30],['文字框 · 底色 / 内边距',630,30],['气泡 · 左对齐 / 1.5 倍行距',30,185],['气泡 · 居中 / 自定义背景',330,185],['序号 · 实心 / 空心 / 方形',630,185],['高亮 · 20% 不透明度',30,365],['高亮 · 50% 不透明度',330,365]] as const) ctx.fillText(label,x,y)
ctx.fillStyle = '#111827'; ctx.fillText('底图文字仍然清晰可读',40,402); ctx.fillText('可按需要调整高亮强度',340,402)
const annotations: Annotation[] = [
  { id:'plain',kind:'text',x:30,y:78,text:'操作步骤\n选择一个项目',color:'#111827',size:24,textStyle:{weight:400,outline:false,lineHeight:1.5} },
  { id:'outlined',kind:'text',x:330,y:78,text:'重要提示\n点击保存按钮',color:'#ef4444',size:24,textStyle:{weight:700,outline:true,lineHeight:1.5} },
  { id:'boxed',kind:'text',x:640,y:78,text:'支持自定义底色\n统一文字排版',color:'#111827',size:22,background:true,textStyle:{weight:600,outline:false,lineHeight:1.5,padding:10,radius:8,backgroundColor:'#fef08a',backgroundOpacity:.8} },
  { id:'bubble',kind:'callout',x:30,y:207,w:245,h:110,text:'打开项目后，\n在这里填写操作说明。',color:'#2563eb',size:20,textStyle:{weight:400,align:'left',lineHeight:1.5,padding:12,radius:8} },
  { id:'bubble-center',kind:'callout',x:330,y:207,w:245,h:110,text:'点击图片添加标注\n让每一步更清晰',color:'#2563eb',size:20,textStyle:{weight:600,align:'center',lineHeight:1.5,padding:12,radius:14,backgroundColor:'#dbeafe'} },
  ...(['circle','ring','square'] as const).map((badge,i) => ({id:`badge-${i}`,kind:'number' as const,x:660+i*90,y:255,r:25,color:i===0?'#ef4444':'#2563eb',badge})),
  {id:'highlight-low',kind:'highlight',x:30,y:378,w:245,h:35,color:'#facc15',opacity:.2},
  {id:'highlight-high',kind:'highlight',x:330,y:378,w:245,h:35,color:'#facc15',opacity:.5},
]
const initial: Page = {id:'content-qa',name:'文字样式',image:base.toDataURL(),width:920,height:440,notes:'',annotations}
async function compare(page: Page) {
  const exported = await renderPageToCanvas(page,99)
  let number=99
  const views = page.annotations.map(a => <g key={a.id}>{a.kind==='text'||a.kind==='callout'?renderContentAnnotation(a,{selected:false,scale:1,magnifierSource:'',pageWidth:920,pageHeight:440}):a.kind==='number'?renderMarkAnnotation(a,{selected:false,label:++number,handleR:4}):renderAreaAnnotation(a,false)}</g>)
  const svg=renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" width={920} height={440}><image href={page.image} width={920} height={440}/>{views}</svg>)
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})), raster=document.createElement('canvas'); raster.width=920; raster.height=440
  try {const image=new Image();image.src=url;await image.decode();const context=raster.getContext('2d')!;context.drawImage(image,0,0);const a=context.getImageData(0,0,920,440).data,b=exported.getContext('2d')!.getImageData(0,0,920,440).data;let difference=0,changed=0;for(let i=0;i<a.length;i+=4){let delta=0;for(let c=0;c<3;c++)delta+=Math.abs(a[i+c]-b[i+c]);difference+=delta;if(delta>24)changed++}const mean=difference/(920*440*3),fraction=changed/(920*440);if(mean>1||fraction>.01)throw Error(`像素差超限：${mean}, ${fraction}`);return `PASS · ${page.annotations.length} 种样例 · 平均通道差 ${mean.toFixed(3)} · 差异像素 ${(fraction*100).toFixed(3)}%`}finally{URL.revokeObjectURL(url);exported.width=0;raster.width=0}
}
export default function Fixture(){
  const [page,setPage]=useState(initial),[ids,setIds]=useState<string[]>([]),[request,setRequest]=useState(0),[result,setResult]=useState('尚未校验')
  const selected=page.annotations.find(a=>a.id===ids[0])
  return <main className="ps-workspace min-h-screen bg-[#252525] text-[#ddd]"><header className="mb-4 flex items-center justify-between"><div><h1 className="text-base font-medium">工具样式 · 第二批</h1><p className="mt-1 text-xs text-[#aaa]">真实编辑器、文本布局和导出 · 隔离合成数据</p></div><button className="rounded border border-white/20 px-3 py-2 text-xs" onClick={()=>{void compare(page).then(setResult).catch(error=>setResult(`FAIL · ${error.message}`))}}>校验文字与导出一致性</button></header>
    <div className="mb-4 flex min-h-11 items-center gap-3 overflow-x-auto border-y border-white/10 bg-[#323232] px-3 py-1 text-xs"><span className="shrink-0">{selected?'当前标注':'选择标注调整样式'}</span>{selected&&<AnnotationParameters annotation={selected} onChange={patch=>setPage(current=>({...current,annotations:current.annotations.map(a=>a.id===selected.id?{...a,...patch} as Annotation:a)}))}/>}</div>
    <div className="mx-auto w-fit shadow-xl"><CanvasEditor page={page} tool="select" color="#ef4444" zoom={1} numberStart={99} mosaicTile={20} numberR={20} textSize={26} strokeWidth={4} selectedId={ids[0]??null} selectedIds={ids} onSelectionChange={setIds} onSelect={id=>setIds(id?[id]:[])} onChange={annotations=>setPage(current=>({...current,annotations}))} editTextRequest={request}/></div>
    <div className="mt-4 flex flex-wrap items-center gap-2">{[['plain','选择文字'],['boxed','选择文字框'],['bubble','选择气泡'],['badge-1','选择序号'],['highlight-low','选择高亮']].map(([id,label])=><button key={id} className="rounded border border-white/20 px-3 py-2 text-xs" onClick={()=>setIds([id])}>{label}</button>)}<button className="rounded border border-white/20 px-3 py-2 text-xs" onClick={()=>setRequest(v=>v+1)}>编辑选中文字</button><button className="rounded border border-white/20 px-3 py-2 text-xs" onClick={()=>setIds([])}>取消选择</button><p role="status" className="ml-auto text-xs text-[#aaa]">{result}</p></div></main>
}
const qaRoot=createRoot(document.getElementById('root')!);qaRoot.render(<Fixture/>);import.meta.hot?.dispose(()=>qaRoot.unmount())

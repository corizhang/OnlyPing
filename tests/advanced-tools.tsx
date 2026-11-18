// Synthetic fixture. Pointer capture is shimmed here only; this is not native touch/pen QA.
import {createRoot} from 'react-dom/client'
import {renderToStaticMarkup} from 'react-dom/server'
import {useState,useLayoutEffect} from 'react'
import CanvasEditor from '../src/components/CanvasEditor'
import AnnotationParameters from '../src/components/AnnotationParameters'
import {renderAreaAnnotation} from '../src/lib/tools/area'
import {renderMarkAnnotation} from '../src/lib/tools/mark'
import {renderContentAnnotation} from '../src/lib/tools/content'
import {renderPageToCanvas} from '../src/lib/render'
import {arrowCurvePoint} from '../src/lib/tools/arrow-geometry'
import {EditHistory} from '../src/lib/history'
import {DEFAULT_ANNOTATION_STYLE,type Page,type Tool,type Annotation} from '../src/types'
import '../src/index.css'
if(location.origin!=='http://127.0.0.1:3011')throw Error('Use isolated QA origin')
const base=document.createElement('canvas');base.width=940;base.height=480
const ctx=base.getContext('2d')!;ctx.fillStyle='#f8fafc';ctx.fillRect(0,0,940,480);ctx.font='14px sans-serif';ctx.fillStyle='#64748b'
for(const [label,x,y] of [['曲线箭头 · 中间控制点',30,28],['说明气泡 · 可拖动指向点',335,28],['局部放大 · 独立取样缓存',685,28],['画笔 · 平滑笔迹',30,255],['Shift · 正方形 / 正圆',335,255]] as const)ctx.fillText(label,x,y)
ctx.fillStyle='#dbeafe';ctx.fillRect(680,60,205,135);ctx.fillStyle='#2563eb';ctx.font='20px sans-serif';ctx.fillText('保存项目',715,125);ctx.font='14px sans-serif';ctx.fillStyle='#64748b';ctx.fillText('移动镜片不会重新编码源图',30,440)
const initial:Page={id:'advanced-qa',name:'高级工具',image:base.toDataURL(),width:940,height:480,notes:'',annotations:[
  {id:'curve',kind:'arrow',x1:35,y1:150,x2:275,y2:150,control:{x:155,y:25},arrowStyle:'curved',color:'#ef4444',width:7},
  {id:'bubble',kind:'callout',x:335,y:55,w:220,h:85,text:'拖动指向点\n把说明关联到目标',color:'#2563eb',size:18,textStyle:{align:'left',weight:600,lineHeight:1.5,padding:12,radius:8,color:'#111827'},tail:{x:620,y:190}},
  {id:'lens',kind:'magnifier',x:730,y:65,w:105,h:105,zoom:2},
  {id:'brush',kind:'freehand',points:[{x:35,y:340},{x:75,y:300},{x:120,y:345},{x:160,y:305},{x:205,y:345},{x:250,y:310}],color:'#ef4444',width:5,smoothed:true},
  {id:'square',kind:'box',x:335,y:285,w:105,h:105,color:'#2563eb',style:{fill:'none',width:3,radius:6}},
  {id:'circle',kind:'ellipse',x:510,y:285,w:105,h:105,color:'#2563eb',style:{fill:'solid',fillOpacity:.12,width:3}},
]}
let latest=initial,writes=0,encodes=0
const createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL),active=new Set<string>()
URL.createObjectURL=blob=>{const url=createURL(blob);active.add(url);return url};URL.revokeObjectURL=url=>{active.delete(url);revokeURL(url)}
const encode=HTMLCanvasElement.prototype.toBlob
HTMLCanvasElement.prototype.toBlob=function(...args){encodes++;return encode.apply(this,args)}
const capture=Element.prototype.setPointerCapture;Element.prototype.setPointerCapture=function(){}
const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())))
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))
async function until(test:()=>boolean,label:string){for(let i=0;i<100;i++){if(test())return;await wait(30)}throw Error(label)}
const svg=()=>document.querySelector<SVGSVGElement>('svg[viewBox="0 0 940 480"]')!
function pointer(target:Element,type:string,x:number,y:number,shiftKey=false){const rect=svg().getBoundingClientRect();target.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:1,clientX:rect.left+x,clientY:rect.top+y,button:0,buttons:type==='pointerup'?0:1,isPrimary:true,shiftKey}))}
const sourceURL=()=>svg().querySelector('image')?.getAttribute('href')??''
async function parity(page:Page){
  const source=await renderPageToCanvas({...page,annotations:page.annotations.filter(a=>a.kind!=='magnifier')});const sourceImage=source.toDataURL();source.width=0
  const exported=await renderPageToCanvas(page)
  const views=page.annotations.filter(a=>!a.hidden).map(a=><g key={a.id}>{a.kind==='arrow'||a.kind==='freehand'||a.kind==='line'||a.kind==='number'?renderMarkAnnotation(a,{selected:false,label:1,handleR:4}):a.kind==='callout'||a.kind==='text'||a.kind==='magnifier'?renderContentAnnotation(a,{selected:false,scale:1,magnifierSource:sourceImage,pageWidth:940,pageHeight:480}):renderAreaAnnotation(a,false)}</g>)
  const markup=renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" width={940} height={480}><image href={page.image} width={940} height={480}/>{views}</svg>),url=URL.createObjectURL(new Blob([markup],{type:'image/svg+xml'})),canvas=document.createElement('canvas');canvas.width=940;canvas.height=480
  try{const image=new Image();image.src=url;await image.decode();const context=canvas.getContext('2d')!;context.drawImage(image,0,0);const a=context.getImageData(0,0,940,480).data,b=exported.getContext('2d')!.getImageData(0,0,940,480).data;let difference=0,changed=0;for(let i=0;i<a.length;i+=4){let delta=0;for(let c=0;c<3;c++)delta+=Math.abs(a[i+c]-b[i+c]);difference+=delta;if(delta>24)changed++}const mean=difference/(940*480*3),fraction=changed/(940*480);if(mean>1||fraction>.01)throw Error(`SVG/Canvas 差异超限 ${mean},${fraction}`);return `导出对比通过 · 平均通道差 ${mean.toFixed(3)} · 差异像素 ${(fraction*100).toFixed(3)}%`}finally{URL.revokeObjectURL(url);exported.width=0;canvas.width=0}
}
export default function Fixture(){
  const [page,setPage]=useState(initial),[tool,setTool]=useState<Tool>('select'),[ids,setIds]=useState<string[]>([]),[result,setResult]=useState('尚未验收'),[running,setRunning]=useState(false),[history]=useState(()=>new EditHistory<Page>())
  useLayoutEffect(()=>{latest=page},[page])
  const selected=page.annotations.find(a=>a.id===ids[0])
  const change=(annotations:Annotation[])=>{writes++;history.record(latest,'pointer');setPage({...latest,annotations})}
  const run=async()=>{setRunning(true);const passed:string[]=[];const assert=(value:unknown,label:string)=>{if(!value)throw Error(label);passed.push(label)}
    try{
      setTool('select');setIds(['curve']);await frame();let a=latest.annotations.find(a=>a.id==='curve')!;if(a.kind!=='arrow')throw Error('curve');const before=structuredClone(a),mid=arrowCurvePoint(a,.5),handle=svg().querySelector('[aria-label="箭头弯曲控制点"]')!;pointer(handle,'pointerdown',mid.x,mid.y);pointer(svg(),'pointermove',200,90);await frame();pointer(svg(),'pointerup',200,90);await frame();a=latest.annotations.find(a=>a.id==='curve')!;assert(a.kind==='arrow'&&Math.abs(arrowCurvePoint(a,.5).x-200)<.01,'曲线控制点拖拽');const previous=history.undo(latest);if(!previous)throw Error('undo');setPage(previous);await frame();assert(JSON.stringify(latest.annotations.find(a=>a.id==='curve'))===JSON.stringify(before),'一次曲线拖拽可一步撤销')
      setIds(['bubble']);await frame();pointer(svg().querySelector('[aria-label="气泡指向点"]')!,'pointerdown',620,190);pointer(svg(),'pointermove',350,215);await frame();pointer(svg(),'pointerup',350,215);await frame();const bubble=latest.annotations.find(a=>a.id==='bubble');assert(bubble?.kind==='callout'&&bubble.tail?.x===350&&bubble.tail.y===215,'气泡指向点拖拽')
      setIds([]);setTool('box');await frame();pointer(svg(),'pointerdown',350,280);await frame();pointer(svg(),'pointermove',490,350,true);await frame();pointer(svg(),'pointerup',490,350,true);await frame();const square=latest.annotations.at(-1);assert(square?.kind==='box'&&square.w===square.h,'Shift 创建正方形')
      setTool('line');setIds([]);await frame();pointer(svg(),'pointerdown',550,300);await frame();pointer(svg(),'pointermove',680,360,true);await frame();pointer(svg(),'pointerup',680,360,true);await frame();const line=latest.annotations.at(-1);assert(line?.kind==='line'&&Math.abs(line.x2-line.x1-(line.y2-line.y1))<.01,'Shift 约束 45 度')
      setTool('freehand');setIds([]);await frame();pointer(svg(),'pointerdown',30,300);await frame();const beforeWrites=writes;for(let i=1;i<=200;i++){pointer(svg(),'pointermove',30+i*2,300+Math.sin(i/20)*10);if(i===100)await frame()}await frame();pointer(svg(),'pointerup',430,300+Math.sin(10)*10);await frame();const brush=latest.annotations.at(-1);assert(brush?.kind==='freehand'&&brush.points.length>4&&brush.points.length<80&&brush.points.at(-1)?.x===430,'画笔点简化保留末端');assert(writes-beforeWrites<=4,'200 次采样按帧提交，非逐事件写入')
      setTool('select');setIds(['lens']);await frame();await until(()=>sourceURL().startsWith('blob:'),'等待放大源图');await wait(160);const original=sourceURL(),beforeEncodes=encodes;pointer(svg(),'pointerdown',780,115);pointer(svg(),'pointermove',810,135);await frame();pointer(svg(),'pointerup',810,135);await frame();await wait(220);assert(sourceURL()===original&&encodes===beforeEncodes,'移动放大镜不重新编码取样图')
      setPage(current=>({...current,annotations:current.annotations.map(a=>a.id==='curve'?{...a,color:'#2563eb'}:a)}));await until(()=>sourceURL().startsWith('blob:')&&sourceURL()!==original,'取样更新');assert(!active.has(original),'源内容变化后撤销旧 Blob URL')
      const current=sourceURL();setPage(value=>({...value,annotations:value.annotations.map(a=>a.id==='lens'?{...a,hidden:true}:a)}));await frame();await wait(30);assert(!active.has(current),'隐藏最后一个放大镜释放源图');setPage(value=>({...value,annotations:value.annotations.map(a=>a.id==='lens'?{...a,hidden:false}:a)}));await until(()=>sourceURL().startsWith('blob:'),'恢复镜片');passed.push(await parity(latest));setIds([]);setResult(`PASS ${passed.length}\n${passed.join('\n')}`)
    }catch(error){setResult(`FAIL\n${passed.join('\n')}\n${error instanceof Error?error.message:String(error)}`)}finally{setRunning(false)}
  }
  return <main className="ps-workspace min-h-screen bg-[#252525] text-[#ddd]" onPointerUp={()=>history.end()} onPointerCancel={()=>history.end()}><header className="mb-3 flex items-center justify-between"><div><h1 className="text-base font-medium">工具交互 · 第三批</h1><p className="text-xs text-[#999]">真实编辑器 · 合成数据 · 非原生触控/压感验收</p></div><button disabled={running} onClick={()=>void run()} className="rounded border border-white/20 px-3 py-2 text-xs">运行交互验收</button></header><div className="mb-3 flex h-11 items-center gap-3 overflow-x-auto bg-[#323232] px-3 text-xs">{selected?<AnnotationParameters annotation={selected} onChange={patch=>setPage(current=>({...current,annotations:current.annotations.map(a=>a.id===selected.id?{...a,...patch} as Annotation:a)}))}/>:<span>曲线中间控制点 · 气泡指向点 · Shift 角度与比例约束</span>}</div><div className="mx-auto w-fit"><CanvasEditor page={page} tool={tool} color="#ef4444" zoom={1} numberStart={0} mosaicTile={20} numberR={20} textSize={20} strokeWidth={4} drawingStyle={{...DEFAULT_ANNOTATION_STYLE,arrowStyle:'curved',smoothBrush:true}} selectedId={ids[0]??null} selectedIds={ids} onSelectionChange={setIds} onSelect={id=>setIds(id?[id]:[])} onChange={change}/></div><div className="mt-3 flex gap-2">{[['curve','选择曲线'],['bubble','选择气泡'],['lens','选择放大镜'],['brush','选择画笔']].map(([id,label])=><button key={id} disabled={running} onClick={()=>{setTool('select');setIds([id])}} className="rounded border border-white/20 px-3 py-1 text-xs">{label}</button>)}<button disabled={running} onClick={()=>{setIds([]);void parity(page).then(setResult).catch(e=>setResult(`FAIL ${e.message}`))}} className="rounded border border-white/20 px-3 py-1 text-xs">校验导出效果</button></div><pre role="status" className="mt-3 whitespace-pre-wrap text-xs text-[#aaa]">{result}</pre></main>
}
const root=createRoot(document.getElementById('root')!);root.render(<Fixture/>);import.meta.hot?.dispose(()=>{root.unmount();Element.prototype.setPointerCapture=capture;HTMLCanvasElement.prototype.toBlob=encode;URL.createObjectURL=createURL;URL.revokeObjectURL=revokeURL})

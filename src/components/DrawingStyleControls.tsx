import type { Annotation, ArrowAnnotation, BoxAnnotation, EllipseAnnotation, ShapeStyle } from '@/types'
import { shapeAppearance } from '@/lib/tools/shape-geometry'
import { arrowGeometry } from '@/lib/tools/arrow-geometry'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Settings2 } from 'lucide-react'

type Drawing = BoxAnnotation | EllipseAnnotation | ArrowAnnotation
export interface DrawingParametersProps { annotation: Drawing; onChange: (patch: Partial<Annotation>) => void }
export default function DrawingStyleControls({ annotation: a, onChange }: DrawingParametersProps) {
  if (a.kind === 'arrow') return <div className="flex shrink-0 items-center gap-1" role="group" aria-label="箭头样式">
    {(['standard', 'emphasis', 'curved'] as const).map(value => <Button key={value} variant="ghost" size="sm" className="h-8 gap-1.5 rounded border border-transparent px-2 aria-pressed:border-[#6899c5] aria-pressed:bg-[#466580]/40" aria-label={{standard:'标准箭头',emphasis:'强调箭头',curved:'曲线箭头'}[value]} aria-pressed={a.arrowStyle === value} onClick={() => onChange({ arrowStyle: value })}><svg width="30" height="16" viewBox="-2 -10 54 24" aria-hidden="true"><path d={arrowGeometry({ ...a, control:undefined, x1: 0, y1: 0, x2: 48, y2: 0, width: 3, arrowStyle: value }).path} fill="currentColor" /></svg>{{standard:'标准',emphasis:'强调',curved:'曲线'}[value]}</Button>)}
    {(!a.arrowStyle || a.arrowStyle === 'legacy') && <span className="px-2 text-[11px] text-[#aaa]">原有样式</span>}
    {a.arrowStyle==='curved'&&a.control&&<Button variant="ghost" size="sm" className="h-7 text-xs" onClick={()=>onChange({control:undefined})}>重置弯曲</Button>}
  </div>
  const s = shapeAppearance(a)
  const patch = (next: ShapeStyle) => onChange({ style: { ...a.style, ...next } })
  const variant = s.fill === 'none' ? 'outline' : s.strokeStyle === 'none' ? 'fill' : 'both'
  return <div className="flex shrink-0 items-center gap-3 border-l border-white/10 pl-3 text-xs text-[#ccc]">
    <div className="flex gap-0.5" role="group" aria-label="形状样式">{(['outline', 'both', 'fill'] as const).map(value => <Button key={value} variant="ghost" size="sm" className="h-8 gap-1.5 rounded border border-transparent px-2 aria-pressed:border-[#6899c5] aria-pressed:bg-[#466580]/40" aria-label={{ outline: '仅边框', both: '边框加填充', fill: '仅填充' }[value]} aria-pressed={variant === value} onClick={() => patch({ fill: value === 'outline' ? 'none' : 'solid', strokeStyle: value === 'fill' ? 'none' : s.strokeStyle === 'none' ? 'solid' : s.strokeStyle })}>
      <svg width="18" height="16" viewBox="0 0 20 18" aria-hidden="true">{a.kind === 'box' ? <rect x="2" y="2" width="16" height="14" rx="1" fill={value === 'outline' ? 'none' : 'currentColor'} fillOpacity={value === 'fill' ? .7 : .2} stroke={value === 'fill' ? 'none' : 'currentColor'} strokeWidth="1.5" /> : <ellipse cx="10" cy="9" rx="8" ry="7" fill={value === 'outline' ? 'none' : 'currentColor'} fillOpacity={value === 'fill' ? .7 : .2} stroke={value === 'fill' ? 'none' : 'currentColor'} strokeWidth="1.5" />}</svg>
      {{ outline: '边框', both: '边框＋填充', fill: '填充' }[value]}
    </Button>)}</div>
    {s.strokeStyle !== 'none' && <><label className="flex items-center gap-2 whitespace-nowrap">线宽<Slider aria-label="形状线宽" className="w-20" min={1} max={16} step={1} value={[s.width]} onValueChange={([width]) => patch({ width })} /><span className="w-8 tabular-nums">{s.width}px</span></label><Select value={s.strokeStyle} onValueChange={value => patch({ strokeStyle: value as ShapeStyle['strokeStyle'] })}><SelectTrigger aria-label="边框线型" className="h-7 w-[84px] shrink-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="solid">实线</SelectItem><SelectItem value="dashed">虚线</SelectItem></SelectContent></Select></>}
    <Popover><PopoverTrigger asChild><Button variant="ghost" size="sm" className="h-8 gap-1.5" aria-label="更多形状设置"><Settings2 className="size-3.5" />更多</Button></PopoverTrigger><PopoverContent align="start" className="w-64 space-y-4 border-white/15 bg-[#2c2c2c] text-[#ddd]">
      <p className="text-xs font-medium">{a.kind === 'box' ? '矩形' : '椭圆'}样式</p>
      {s.fill === 'solid' ? <><label className="flex items-center justify-between text-xs">填充颜色<input type="color" aria-label="填充颜色" value={s.fillColor.startsWith('#') && s.fillColor.length === 7 ? s.fillColor : '#ef4444'} onInput={event => patch({ fillColor: event.currentTarget.value })} className="h-7 w-10 cursor-pointer border-0 bg-transparent p-0" /></label><Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => patch({ fillColor: undefined })}>填充跟随边框颜色</Button><label className="flex items-center gap-2 text-xs">填充不透明度<Slider aria-label="填充不透明度" className="flex-1" min={s.strokeStyle === 'none' ? 1 : 0} max={100} step={1} value={[Math.round(s.fillOpacity * 100)]} onValueChange={([value]) => patch({ fillOpacity: value / 100 })} /><span className="w-8 text-right">{Math.round(s.fillOpacity * 100)}%</span></label></> : <p className="text-xs text-[#aaa]">当前为仅边框，内部保持透明。</p>}
      {a.kind === 'box' && <label className="flex items-center gap-2 text-xs">圆角<Slider aria-label="矩形圆角" className="flex-1" min={0} max={40} step={1} value={[a.style?.radius ?? 0]} onValueChange={([radius]) => patch({ radius })} /><span className="w-8 text-right">{a.style?.radius ?? 0}px</span></label>}
    </PopoverContent></Popover>
  </div>
}

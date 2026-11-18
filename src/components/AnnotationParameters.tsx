import type { Annotation } from '@/types'
import { TOOL_CATALOG, TOOL_PARAMETERS } from '@/lib/tools/catalog'
import { Slider } from '@/components/ui/slider'
import DrawingParameters from './DrawingParameters'
import ContentParameters from './ContentParameters'
import { Button } from '@/components/ui/button'

export default function AnnotationParameters({ annotation, onChange }: { annotation: Annotation; onChange: (patch: Partial<Annotation>) => void }) {
  if (annotation.kind === 'box' || annotation.kind === 'ellipse') return <DrawingParameters annotation={annotation} onChange={onChange} />
  if (annotation.kind === 'highlight') return <ContentParameters annotation={annotation} onChange={onChange} />
  const key = TOOL_CATALOG[annotation.kind].parameter
  if (!key) return null
  const parameter = TOOL_PARAMETERS[key]
  let value: number
  let property: 'size' | 'r' | 'width' | 'tile' | 'zoom'
  switch (annotation.kind) {
    case 'text': value = annotation.size ?? 26; property = 'size'; break
    case 'callout': value = annotation.size ?? 16; property = 'size'; break
    case 'number': value = annotation.r ?? 20; property = 'r'; break
    case 'arrow': value = annotation.width ?? 6; property = 'width'; break
    case 'line': case 'freehand': value = annotation.width ?? 4; property = 'width'; break
    case 'mosaic': value = annotation.tile ?? 20; property = 'tile'; break
    case 'magnifier': value = annotation.zoom; property = 'zoom'; break
    default: return null
  }
  return <>{annotation.kind === 'arrow' && <DrawingParameters annotation={annotation} onChange={onChange} />}<label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-slate-300">
    {parameter.label}
    <Slider min={parameter.min} max={parameter.max} step={key === 'zoom' ? .1 : 1} value={[value]}
      onValueChange={([next]) => onChange({ [property]: next } as Partial<Annotation>)} className="w-20" aria-label={parameter.label} />
    <span className="min-w-6 tabular-nums">{key === 'zoom' ? `${value.toFixed(1)}×` : key === 'mosaicTile' ? `${value}px` : value}</span>
  </label>{annotation.kind==='freehand'&&<Button variant="ghost" size="sm" aria-label="平滑笔迹" aria-pressed={!!annotation.smoothed} onClick={()=>onChange({smoothed:!annotation.smoothed})}>平滑笔迹</Button>}{(annotation.kind === 'text' || annotation.kind === 'callout' || annotation.kind === 'number') && <ContentParameters annotation={annotation} onChange={onChange} />}</>
}

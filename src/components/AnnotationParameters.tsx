import type { Annotation } from '@/types'
import { TOOL_CATALOG, TOOL_PARAMETERS } from '@/lib/tools/catalog'
import { Slider } from '@/components/ui/slider'

export default function AnnotationParameters({ annotation, onChange }: { annotation: Annotation; onChange: (patch: Partial<Annotation>) => void }) {
  const key = TOOL_CATALOG[annotation.kind].parameter
  if (!key) return null
  const parameter = TOOL_PARAMETERS[key]
  let value: number
  let property: 'size' | 'r' | 'width' | 'tile' | 'zoom'
  switch (annotation.kind) {
    case 'text': value = annotation.size ?? 26; property = 'size'; break
    case 'number': value = annotation.r ?? 20; property = 'r'; break
    case 'arrow': case 'line': case 'freehand': value = annotation.width ?? 6; property = 'width'; break
    case 'mosaic': value = annotation.tile ?? 20; property = 'tile'; break
    case 'magnifier': value = annotation.zoom; property = 'zoom'; break
    default: return null
  }
  return <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-slate-300">
    {parameter.label}
    <Slider min={parameter.min} max={parameter.max} step={key === 'zoom' ? .1 : 1} value={[value]}
      onValueChange={([next]) => onChange({ [property]: next } as Partial<Annotation>)} className="w-20" aria-label={parameter.label} />
    <span className="min-w-6 tabular-nums">{key === 'zoom' ? `${value.toFixed(1)}×` : key === 'mosaicTile' ? `${value}px` : value}</span>
  </label>
}

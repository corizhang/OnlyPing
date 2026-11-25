import { useEffect, useId, useRef, useState } from 'react'
import { LayoutTemplate, PanelTop, Type, Upload, Trash2, RotateCcw } from 'lucide-react'
import { DEFAULT_EXPORT_STYLE, type ExportFooter, type ExportStyle, type TextAlignment } from '@/types'
import { DEFAULT_DOCUMENT_HEADER } from '@/lib/document-layout'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Slider } from './ui/slider'
import { Switch } from './ui/switch'

const field = 'h-9 w-full rounded border border-white/15 bg-[#303030] px-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500'
function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <div className="document-setting-row grid grid-cols-1 items-center gap-3 border-b border-white/10 py-4"><div className="min-w-0"><div className="text-sm font-medium">{title}</div>{description && <p className="mt-1 text-xs leading-relaxed text-[#999]">{description}</p>}</div><div className="min-w-0">{children}</div></div>
}
function NumberControl({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange: (value: number) => void }) {
  const [edit, setEdit] = useState({ baseline: value, draft: String(value) })
  const draft = edit.baseline === value ? edit.draft : String(value)
  return <Input aria-label={label} type="number" min={min} max={max} value={draft} className="h-9 w-20 text-right tabular-nums" onChange={e => setEdit({ baseline: value, draft: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} onBlur={() => { const next = draft.trim() && Number.isFinite(Number(draft)) ? Math.max(min, Math.min(max, Number(draft))) : value; setEdit({ baseline: next, draft: String(next) }); if (next !== value) onChange(next) }} />
}
interface Props {
  style: ExportStyle
  onChange: (style: ExportStyle) => void
  footer?: ExportFooter
  onFooterChange?: (footer: ExportFooter) => void
  compact?: boolean
}
export default function DocumentLayoutSettings({ style, onChange, footer, onFooterChange, compact = false }: Props) {
  const [section, setSection] = useState<'layout' | 'header' | 'type'>('layout')
  const id = useId()
  const backgroundInput = useRef<HTMLInputElement>(null), logoInput = useRef<HTMLInputElement>(null)
  const header = { ...DEFAULT_DOCUMENT_HEADER, ...style.header }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  const latestStyle = useRef(style)
  useEffect(() => { latestStyle.current = style }, [style])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const changeHeader = (value: Partial<typeof header>) => onChange({ ...style, header: { ...header, ...value } })
  // Input disables other controls while decoding so an async upload cannot overwrite newer edits.
  const upload = async (file: File | undefined, target: 'image' | 'logo') => {
    if (!file) return
    setBusy(true); setError('')
    let bitmap: ImageBitmap | undefined
    try {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('请选择不超过 20 MB 的 PNG、JPEG、WebP 或 GIF 图片。')
      bitmap = await createImageBitmap(file)
      if (bitmap.width * bitmap.height > 40000000) throw new Error('图片不能超过 4000 万像素。')
      const ratio = Math.min(1, (target === 'logo' ? 512 : 1600) / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio)); canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
      try {
        canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const image = canvas.toDataURL(target === 'logo' ? 'image/png' : 'image/jpeg', 0.85)
        if (image.length > 4 * 1024 * 1024) throw new Error('处理后的图片仍过大，请使用较小的图片。')
        if (alive.current) onChange({ ...latestStyle.current, header: { ...DEFAULT_DOCUMENT_HEADER, ...latestStyle.current.header, [target]: image } })
      } finally { canvas.width = 0; canvas.height = 0 }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '图片读取失败，原设置保留。') }
    finally { bitmap?.close(); setBusy(false) }
  }
  const colorControl = (label: string, value: string, change: (value: string) => void) => <div className="flex h-9 items-center gap-3"><Input type="color" aria-label={label} value={value} onChange={e => change(e.target.value)} className="h-9 w-12 p-1" /><span className="text-xs uppercase text-[#aaa]">{value}</span></div>
  return <div className={compact ? '' : '[&_.document-setting-row]:grid-cols-[minmax(0,1fr)_220px]'}>
    <nav aria-label="排版设置分类" className="mb-2 flex gap-1 rounded bg-black/15 p-1">
      {([['layout', '步骤布局', LayoutTemplate], ['header', '文档头部', PanelTop], ['type', '文字页脚', Type]] as const).map(([key, label, Icon]) => <Button key={key} variant="ghost" size="sm" aria-pressed={section === key} onClick={() => setSection(key)} className={`min-w-0 flex-1 gap-1.5 px-2 text-xs ${section === key ? 'bg-[#3c5871] text-white hover:bg-[#3c5871]' : 'text-[#aaa]'}`}><Icon className="size-3.5 shrink-0" />{label}</Button>)}
    </nav>
    <fieldset disabled={busy}>
      {section === 'layout' && <>
        <Row title="步骤排版" description="多列时同一行图片顶部对齐，末行保持列宽。"><select aria-label="步骤排版" className={field} value={style.layout ?? 'top'} onChange={e => onChange({ ...style, layout: e.target.value as ExportStyle['layout'] })}><option value="top">上文下图 · 单列</option><option value="left">左文右图</option><option value="right">左图右文</option><option value="two">双列 · 独立说明</option><option value="three">三列 · 独立说明</option><option value="shared">双图 · 共享说明区</option></select></Row>
        {(style.layout === 'left' || style.layout === 'right') && <Row title="文字区域比例"><select aria-label="文字区域比例" className={field} value={style.textWidth ?? 40} onChange={e => onChange({ ...style, textWidth: Number(e.target.value) })}><option value="30">30%</option><option value="40">40%</option><option value="50">50%</option></select></Row>}
        {style.layout === 'shared' && <p className="pt-3 text-xs leading-relaxed text-[#999]">按顺序两图一组，共享区域依次展示两张图的原有说明。</p>}
        <Row title="步骤编号样式" description={style.stepHeading === 'circle' ? '圆点数字旁显示步骤名称，可在右侧步骤列表中修改。' : '用于文档中的步骤标题。'}><select aria-label="步骤编号样式" className={field} value={style.stepHeading ?? 'text'} onChange={e => onChange({ ...style, stepHeading: e.target.value as ExportStyle['stepHeading'] })}><option value="text">常规文字 · 步骤 1</option><option value="circle">圆点 · ① 步骤名称</option><option value="badge">文字加 Badge · 步骤 [1]</option></select></Row>
        {style.stepHeading && style.stepHeading !== 'text' && <Row title="编号颜色">{colorControl('步骤编号颜色', style.stepColor ?? '#3c6e9c', stepColor => onChange({ ...style, stepColor }))}</Row>}
        <Row title="截图宽度" description="相对于所在列的宽度，不影响单张标注图片导出。"><div className="flex items-center gap-3"><Slider min={25} max={100} step={5} value={[style.stepImageScale]} onValueChange={([stepImageScale]) => onChange({ ...style, stepImageScale })} aria-label="步骤图片宽度比例" /><span className="w-10 shrink-0 text-right text-xs tabular-nums">{style.stepImageScale}%</span></div></Row>
      </>}
      {section === 'header' && <>
        <Row title="头部高度" description="80–600 px；内容超过设定高度时自动撑开，标题不裁切。"><div className="flex items-center gap-3"><Slider min={80} max={600} step={10} aria-label="头部高度" value={[header.height]} onValueChange={([height]) => changeHeader({ height })} /><NumberControl label="头部最小高度" value={header.height} min={80} max={600} onChange={height => changeHeader({ height })} /></div></Row>
        <Row title="副标题"><textarea aria-label="文档副标题" rows={3} maxLength={2000} value={header.subtitle} onChange={e => changeHeader({ subtitle: e.target.value })} placeholder="补充标题或版本说明" className="w-full resize-y rounded border border-white/15 bg-[#303030] p-2 text-sm outline-none focus:ring-2 focus:ring-sky-500" /></Row>
        <Row title="背景"><select aria-label="头部背景" className={field} value={header.background} onChange={e => changeHeader({ background: e.target.value as typeof header.background, textColor: e.target.value === 'plain' ? '#192331' : '#ffffff' })}><option value="plain">简洁白底</option><option value="color">纯色背景</option><option value="image">图片背景</option></select></Row>
        {header.background !== 'plain' && <Row title="背景色">{colorControl('头部背景色', header.color, color => changeHeader({ color }))}</Row>}
        <Row title="标题文字颜色">{colorControl('头部文字色', header.textColor, textColor => changeHeader({ textColor }))}</Row>
        {header.background === 'image' && <>
          <Row title="背景图片" description="本机处理，随项目保存。"><div className="space-y-2">{header.image && <img src={header.image} alt="头部背景缩略图" className="h-20 w-full rounded border border-white/10 bg-black/15 object-contain" />}<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => backgroundInput.current?.click()}><Upload className="size-3.5" />{header.image ? '更换图片' : '选择图片'}</Button>{header.image && <Button size="icon-sm" variant="ghost" aria-label="移除背景图" onClick={() => changeHeader({ image: undefined })}><Trash2 className="size-4" /></Button>}</div></div></Row>
          <Row title="图片显示方式" description="完整显示保留全图，周围留出背景色。"><select aria-label="背景图片显示方式" className={field} value={header.imageFit} onChange={e => changeHeader({ imageFit: e.target.value as typeof header.imageFit })}><option value="cover">铺满裁切</option><option value="contain">完整显示</option></select></Row>
          <Row title="暗色遮罩"><div className="flex items-center gap-3"><Slider aria-label="背景遮罩" min={0} max={0.9} step={0.05} value={[header.overlay]} onValueChange={([overlay]) => changeHeader({ overlay })} /><span className="w-10 shrink-0 text-right text-xs tabular-nums">{Math.round(header.overlay * 100)}%</span></div></Row>
        </>}
        <Row title="Logo"><div className="flex items-center gap-3">{header.logo && <img src={header.logo} alt="Logo 缩略图" className="size-12 rounded bg-black/15 object-contain" />}<Button size="sm" variant="outline" onClick={() => logoInput.current?.click()}><Upload className="size-3.5" />{header.logo ? '更换' : '选择 Logo'}</Button>{header.logo && <Button size="icon-sm" variant="ghost" aria-label="移除 Logo" onClick={() => changeHeader({ logo: undefined })}><Trash2 className="size-4" /></Button>}</div></Row>
        {header.logo && <><Row title="Logo 位置"><select aria-label="Logo 位置" className={field} value={header.logoPosition} onChange={e => changeHeader({ logoPosition: e.target.value as typeof header.logoPosition })}><option value="left">标题左侧</option><option value="right">标题右侧</option></select></Row><Row title="Logo 大小"><div className="flex items-center gap-3"><Slider aria-label="Logo 大小" min={24} max={120} value={[header.logoSize]} onValueChange={([logoSize]) => changeHeader({ logoSize })} /><span className="w-10 shrink-0 text-right text-xs tabular-nums">{header.logoSize}px</span></div></Row></>}
      </>}
      {section === 'type' && <>
        {([{ key: 'title', alignKey: 'titleAlign', label: '主标题' }, { key: 'heading', alignKey: 'headingAlign', label: '步骤标题' }, { key: 'notes', alignKey: 'notesAlign', label: '说明文字' }] as const).map(({ key, alignKey, label }) => <Row key={key} title={label}><div className="flex items-center gap-2"><NumberControl label={`${label}字号`} value={style[key]} min={12} max={key === 'notes' ? 48 : 72} onChange={value => onChange({ ...style, [key]: value })} /><select aria-label={`${label}对齐方式`} className={field} value={style[alignKey]} onChange={e => onChange({ ...style, [alignKey]: e.target.value as TextAlignment })}><option value="left">靠左</option><option value="center">居中</option><option value="right">靠右</option></select></div></Row>)}
        {footer && onFooterChange && <><Row title="编制单位"><Input aria-label="页脚编制单位" className="h-9" value={footer.org} placeholder="编制单位" onChange={e => onFooterChange({ ...footer, org: e.target.value })} /></Row><Row title="版本号"><Input aria-label="页脚版本号" className="h-9" value={footer.version} placeholder="如 V1.0" onChange={e => onFooterChange({ ...footer, version: e.target.value })} /></Row><Row title="显示编制日期"><Switch id={`${id}-date`} aria-label="显示编制日期" checked={footer.showDate} onCheckedChange={showDate => onFooterChange({ ...footer, showDate })} /></Row></>}
      </>}
    </fieldset>
    <input ref={backgroundInput} type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="上传头部背景" onChange={e => { void upload(e.target.files?.[0], 'image'); e.currentTarget.value = '' }} />
    <input ref={logoInput} type="file" className="hidden" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="上传 Logo" onChange={e => { void upload(e.target.files?.[0], 'logo'); e.currentTarget.value = '' }} />
    {busy && <p role="status" className="py-3 text-xs text-[#aaa]">正在处理图片…</p>}{error && <p role="alert" className="py-3 text-sm text-amber-300">{error}</p>}
    <div className="flex items-center justify-between gap-2 pt-4"><span className="text-xs text-[#888]">随当前项目保存</span><Button size="sm" variant="ghost" disabled={busy} onClick={() => onChange(DEFAULT_EXPORT_STYLE)}><RotateCcw className="size-3.5" />恢复版式</Button></div>
  </div>
}

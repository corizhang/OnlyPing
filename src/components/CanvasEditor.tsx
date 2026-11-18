import { toggleSelection, editableSelection } from '@/lib/selection'
import { useAnnotationKeyboard } from '@/hooks/use-annotation-keyboard'
import { HANDLES, HANDLE_CURSOR, handlePos, clamp, resizeRect, type ResizeHandle } from '@/lib/tools/canvas-geometry'
import { translateAnnotation } from '@/lib/tools/annotation-geometry'
import { controlFromBend } from '@/lib/tools/arrow-geometry'
import { calloutTail } from '@/lib/tools/callout-geometry'
import { drawingRect, snapEndpoint } from '@/lib/tools/interaction-geometry'
import { simplifyStroke } from '@/lib/tools/stroke-geometry'
import { createMagnifierSourceCache } from '@/lib/magnifier-source'
import { TOOL_CATALOG } from '@/lib/tools/catalog'
import { hitArea, isAreaAnnotation, renderAreaAnnotation } from '@/lib/tools/area'
import { createAnnotation, type DrawableTool } from '@/lib/tools'
import { hitMark, isMarkAnnotation, renderMarkAnnotation } from '@/lib/tools/mark'
import { createContentAnnotation, hitContent, isContentAnnotation, renderContentAnnotation } from '@/lib/tools/content'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isComposingKey, type InputSettlement } from '@/lib/input-settlement'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Annotation, AnnotationStyle, Page, Rect, Tool } from '@/types'
import { loadImage, mosaicCanvasRegion, renderPageToCanvas } from '@/lib/render'
import { canvasBlob, releaseCanvas } from '@/lib/render-task'
import { startEditorPhase } from '@/lib/editor-performance'
import { MOSAIC_DEFAULT_TILE, uid } from '@/types'
import { calloutLayout, textLayout } from '@/lib/tools/text-layout'
import type { MarkAnnotation, MarkViewOptions } from '@/lib/tools/types'

function MarkView({ annotation, ...options }: { annotation: MarkAnnotation } & MarkViewOptions) {
  return renderMarkAnnotation(annotation, options)
}

interface Props {
  inputSessions?: InputSettlement
  page: Page
  tool: Tool
  color: string
  zoom: number
  numberStart: number
  mosaicTile: number
  /** 新建序号标注的圆半径 */
  numberR: number
  /** 新建文字标注的字号 */
  textSize: number
  strokeWidth: number
  drawingStyle?: Pick<AnnotationStyle, 'shape' | 'arrowStyle' | 'text' | 'numberBadge' | 'highlightOpacity' | 'smoothBrush'>
  selectedId: string | null
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
  editTextRequest?: number
  onTextEditingChange?: (editing: boolean) => void
  onSelect: (id: string | null) => void
  onChange: (annotations: Annotation[]) => void
  onZoomChange?: (zoom: number) => void
  onCrop?: (rect: Rect) => void
}

type DragState =
  | { mode: 'create'; startX: number; startY: number; id: string }
  | { mode: 'freehand'; id: string; points: {x:number;y:number}[]; frame?: number }
  | { mode: 'curve-control'; id: string }
  | { mode: 'callout-tail'; id: string }
  | { mode: 'move'; id: string; startX: number; startY: number; snapshot: Annotation[] }
  | { mode: 'resize'; id: string; handle: ResizeHandle; snapshot: Rect }
  | { mode: 'arrow-end'; id: string; end: 'p1' | 'p2' }
  | { mode: 'crop-handle'; handle: ResizeHandle; snapshot: Rect }
  | { mode: 'crop-move'; startX: number; startY: number; snapshot: Rect }
  | { mode: 'crop-draw'; startX: number; startY: number }

function ResizeHandles({ r, stroke, handleR, onDown }: { r: Rect; stroke: string; handleR: number; onDown: (e: React.PointerEvent, h: ResizeHandle) => void }) {
  return <>{
    HANDLES.map((h) => {
      const p = handlePos(r, h)
      return (
        <rect
          key={h}
          x={p.x - handleR}
          y={p.y - handleR}
          width={handleR * 2}
          height={handleR * 2}
          fill="#ffffff"
          stroke={stroke}
          strokeWidth={2}
          style={{ cursor: HANDLE_CURSOR[h] }}
          onPointerDown={(e) => onDown(e, h)}
        />
      )
    })
  }</>
}

export default function CanvasEditor({ page, tool, color, zoom, numberStart, mosaicTile, numberR, textSize, strokeWidth, drawingStyle, selectedId, selectedIds, onSelectionChange, editTextRequest, onTextEditingChange, onSelect, onChange, onZoomChange, onCrop, inputSessions }: Props) {
  const textInputRef = useRef<HTMLTextAreaElement>(null)
  const composingTextRef = useRef(false)
  const commitAfterCompositionRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const baseImageRef = useRef<HTMLImageElement | null>(null)
  const annotationsRef = useRef(page.annotations)
  useLayoutEffect(()=>{annotationsRef.current=page.annotations},[page.annotations])
  const mosaicsRef = useRef<Extract<Annotation, { kind: 'mosaic' }>[]>([])
  const redactsRef = useRef<Extract<Annotation, { kind: 'redact' }>[]>([])
  const [magnifierSource, setMagnifierSource] = useState('')
  const scale = zoom
  const displayW = page.width * zoom
  const dragRef = useRef<DragState | null>(null)
  useEffect(()=>()=>{const drag=dragRef.current;if(drag?.mode==='freehand'&&drag.frame!==undefined)cancelAnimationFrame(drag.frame);dragRef.current=null},[page.id])
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const textCommitRef = useRef(false)
  const textCancelRef = useRef(false)
  const suppressTextClickRef = useRef(false)
  const lastEditRequestRef = useRef(editTextRequest)
  const [textPos, setTextPos] = useState({ x: 0, y: 0, background: false })
  const [editTarget, setEditTarget] = useState<Extract<Annotation, { kind: 'text' | 'callout' }> | null>(null)
  const [cropRect, setCropRect] = useState<Rect | null>(null)
  useEffect(() => () => onTextEditingChange?.(false), [onTextEditingChange])

  // Ctrl + 滚轮缩放
  useEffect(() => {
    const el = containerRef.current
    if (!el || !onZoomChange) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const next = zoom * (e.deltaY < 0 ? 1.1 : 0.9)
      onZoomChange(Math.min(4, Math.max(0.05, next)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, onZoomChange])

  // 裁剪：进入裁剪工具时给出覆盖全图的初始选区
  useEffect(() => {
    if (tool === 'crop') {
      // 切换工具时初始化一次可交互选区，后续尺寸由用户拖动维护。
      setCropRect({ x: 0, y: 0, w: page.width, h: page.height })
    } else {
      setCropRect(null)
    }
  }, [tool, page.id, page.width, page.height])

  // 底图只在图片或尺寸变化时载入，避免拖动普通标注时反复清空并重绘图片。
  const mosaics = page.annotations.filter(
    (ann): ann is Extract<Annotation, { kind: 'mosaic' }> => ann.kind === 'mosaic' && !ann.hidden
  )
  const redacts = page.annotations.filter(
    (ann): ann is Extract<Annotation, { kind: 'redact' }> => ann.kind === 'redact' && !ann.hidden
  )
  useEffect(() => {
    mosaicsRef.current = mosaics
    redactsRef.current = redacts
  }, [mosaics, redacts])
  const hasMagnifier = page.annotations.some((ann) => ann.kind === 'magnifier' && !ann.hidden)
  const [sourceCache] = useState(createMagnifierSourceCache)
  const sourceAnnotations = sourceCache(page.annotations)
  const mosaicKey = [...mosaics, ...redacts]
    .map((ann) => `${ann.id}:${ann.x}:${ann.y}:${ann.w}:${ann.h}:${ann.kind === 'mosaic' ? ann.tile ?? MOSAIC_DEFAULT_TILE : ann.color}`)
    .join('|')

  const drawBase = useCallback((img: HTMLImageElement) => {
    const canvas = baseRef.current
    if (!canvas) return
    const finish = startEditorPhase('canvas-draw')
    if (canvas.width !== page.width) canvas.width = page.width
    if (canvas.height !== page.height) canvas.height = page.height
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, page.width, page.height)
    ctx.drawImage(img, 0, 0)
    for (const ann of mosaicsRef.current) {
      mosaicCanvasRegion(
        canvas,
        Math.round(ann.x),
        Math.round(ann.y),
        Math.round(ann.w),
        Math.round(ann.h),
        ann.tile ?? MOSAIC_DEFAULT_TILE
      )
    }
    for (const ann of redactsRef.current) {
      ctx.fillStyle = ann.color
      ctx.fillRect(ann.x, ann.y, ann.w, ann.h)
    }
    finish()
  }, [page.width, page.height])

  useEffect(() => {
    let cancelled = false
    let url: string | undefined
    void Promise.resolve().then(()=>{if(!cancelled)setMagnifierSource('')})
    if (!hasMagnifier) return ()=>{cancelled=true}
    const timer = setTimeout(() => {
      const sourcePage = { id: 'magnifier-source', name: '', notes: '', width: page.width, height: page.height, image: page.image, annotations: sourceAnnotations }
      void renderPageToCanvas(sourcePage, numberStart).then(async (canvas) => {
        try { if(cancelled)return;const blob=await canvasBlob(canvas);if(!cancelled){url=URL.createObjectURL(blob);setMagnifierSource(url)} }
        finally { releaseCanvas(canvas) }
      }).catch(() => undefined)
    }, 100)
    return () => {
      cancelled = true
      clearTimeout(timer)
      if(url)URL.revokeObjectURL(url)
    }
  }, [hasMagnifier, page.width, page.height, page.image, sourceAnnotations, numberStart])

  useEffect(() => {
    let cancelled = false
    loadImage(page.image).then((img) => {
      if (cancelled) return
      baseImageRef.current = img
      drawBase(img)
    })
    return () => {
      cancelled = true
    }
  }, [page.image, drawBase])

  // 只有马赛克区域变化时才重绘底图；移动文字、序号、箭头或画框不触发图片重载。
  useEffect(() => {
    if (baseImageRef.current) drawBase(baseImageRef.current)
  }, [mosaicKey, drawBase])

  const toNatural = useCallback(
    (e: { clientX: number; clientY: number; currentTarget: EventTarget & Element }) => {
      const rect = e.currentTarget.getBoundingClientRect()
      return {
        x: (e.clientX - rect.left) / scale,
        y: (e.clientY - rect.top) / scale,
      }
    },
    [scale]
  )

  const hitTest = useCallback(
    (x: number, y: number): Annotation | null => {
      const list = [...page.annotations].reverse()
      for (const ann of list) {
        if (ann.hidden || ann.locked) continue
        if (isMarkAnnotation(ann)) {
          if (hitMark(ann, x, y)) return ann
        } else if (isContentAnnotation(ann)) {
          if (hitContent(ann, x, y)) return ann
        } else if (isAreaAnnotation(ann) && hitArea(ann, x, y)) {
          return ann
        }
      }
      return null
    },
    [page.annotations]
  )

  const updateAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>) => {
      onChange(page.annotations.map((a) => (a.id === id && !a.locked ? ({ ...a, ...patch } as Annotation) : a)))
    },
    [page.annotations, onChange]
  )

  const commitText = useCallback(() => {
    if (!editingTextId || composingTextRef.current || textCommitRef.current || textCancelRef.current) return
    textCommitRef.current = true
    const text = (textInputRef.current?.value ?? textDraft).trim()
    const editing = page.annotations.find((a) => a.id === editingTextId)
    if (editing && (editing.kind === 'text' || editing.kind === 'callout')) {
      if (text) {
        const layout = editing.kind === 'callout' ? calloutLayout({ ...editing, text }) : null
        updateAnnotation(editing.id, layout ? { text, w: layout.w, h: layout.h } : { text })
      }
      else onChange(page.annotations.filter((a) => a.id !== editing.id))
    } else if (text && editingTextId === '__new__') {
      const ann = createContentAnnotation('text', uid(), textPos.x, textPos.y, {
        text, color, textSize, background: textPos.background, textStyle: drawingStyle?.text,
      })
      onChange([...page.annotations, ann])
      onSelect(ann.id)
    }
    setEditingTextId(null)
    setTextDraft('')
    onTextEditingChange?.(false)
  }, [textDraft, editingTextId, textPos, page, color, textSize, drawingStyle, onChange, onSelect, onTextEditingChange, updateAnnotation, setEditingTextId, setTextDraft])

  useLayoutEffect(() => inputSessions?.register(commitText), [inputSessions, commitText])

  const beginTextEdit = useCallback((id: string, text: string) => {
    composingTextRef.current = false
    commitAfterCompositionRef.current = false
    const target = page.annotations.find(a => a.id === id)
    setEditTarget(target?.kind === 'text' || target?.kind === 'callout' ? target : null)
    textCommitRef.current = false
    textCancelRef.current = false
    setTextDraft(text)
    setEditingTextId(id)
    onTextEditingChange?.(true)
  }, [page, onTextEditingChange, setEditTarget, setTextDraft, setEditingTextId])

  useEffect(() => {
    if (editTextRequest === lastEditRequestRef.current) return
    lastEditRequestRef.current = editTextRequest
    const ann = page.annotations.find(a => a.id === selectedId)
    // 顶部编辑按钮发出的显式请求，需要在画布内挂载并聚焦输入区。
    if (ann?.kind === 'text' || ann?.kind === 'callout') beginTextEdit(ann.id, ann.text)
  }, [editTextRequest, selectedId, page.annotations, beginTextEdit])

  const onPointerDown = (e: React.PointerEvent) => {
    if (editingTextId) {
      suppressTextClickRef.current = true
      return
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const { x, y } = toNatural(e)

    if (tool === 'select') {
      const hit = hitTest(x, y)
      if (hit) {
        const additive = e.shiftKey || e.ctrlKey || e.metaKey
        const ids = additive ? toggleSelection(selectedIds, hit.id, true) : selectedIds.includes(hit.id) ? selectedIds : [hit.id]
        onSelectionChange(ids)
        if (!additive) dragRef.current = { mode: 'move', id: hit.id, startX: x, startY: y, snapshot: editableSelection(page.annotations, ids) }
      } else if (!e.shiftKey) {
        onSelectionChange([])
      }
      return
    }

    const interaction = TOOL_CATALOG[tool].interaction
    if (interaction === 'point' || interaction === 'endpoints' || interaction === 'freehand') {
      const ann = createAnnotation(tool as DrawableTool, x, y, { color, numberR, mosaicTile, strokeWidth, textSize, ...drawingStyle })
      onChange([...page.annotations, ann])
      onSelect(ann.id)
      if (interaction === 'endpoints') dragRef.current = { mode: 'arrow-end', id: ann.id, end: 'p2' }
      if (interaction === 'freehand') dragRef.current = { mode: 'freehand', id: ann.id, points:[{x,y}] }
      return
    }

    if (interaction === 'text') {
      // 等 click 阶段再挂载自动聚焦的输入框，避免它被本次 pointer 序列立即 blur。
      return
    }

    if (tool === 'crop') {
      const c = cropRect
      const hr = (7 / scale) * 1.6
      if (c) {
        for (const h of HANDLES) {
          const p = handlePos(c, h)
          const dx = x - p.x
          const dy = y - p.y
          if (dx * dx + dy * dy <= hr * hr) {
            dragRef.current = { mode: 'crop-handle', handle: h, snapshot: c }
            return
          }
        }
        if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) {
          dragRef.current = { mode: 'crop-move', startX: x, startY: y, snapshot: c }
          return
        }
      }
      dragRef.current = { mode: 'crop-draw', startX: x, startY: y }
      setCropRect({ x, y, w: 0, h: 0 })
      return
    }

    // 矩形和聚焦工具：拖拽创建
    const ann = createAnnotation(tool as DrawableTool, x, y, { color, numberR, mosaicTile, strokeWidth, textSize, ...drawingStyle })
    onChange([...page.annotations, ann])
    onSelect(ann.id)
    dragRef.current = { mode: 'create', startX: x, startY: y, id: ann.id }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const { x, y } = toNatural(e)
    const bounds = { w: page.width, h: page.height }

    if (drag.mode === 'create') {
      const a=page.annotations.find(a=>a.id===drag.id)
      updateAnnotation(drag.id,drawingRect(drag.startX,drag.startY,x,y,bounds,e.shiftKey&&(a?.kind==='box'||a?.kind==='ellipse'||a?.kind==='magnifier')))
    } else if (drag.mode === 'freehand') {
      const events=e.nativeEvent.getCoalescedEvents?.()??[]
      for(const event of events.length?events:[e.nativeEvent]){const p=toNatural({clientX:event.clientX,clientY:event.clientY,currentTarget:e.currentTarget}),last=drag.points.at(-1)!;if(Math.hypot(last.x-p.x,last.y-p.y)>=2)drag.points.push(p)}
      if(drag.frame===undefined)drag.frame=requestAnimationFrame(()=>{drag.frame=undefined;if(dragRef.current!==drag)return;onChange(annotationsRef.current.map(a=>a.id===drag.id&&!a.locked?{...a,points:drag.points.map(p=>({...p}))} as Annotation:a))})
    } else if (drag.mode === 'arrow-end') {
      const a=page.annotations.find(a=>a.id===drag.id)
      if(a&&(a.kind==='arrow'||a.kind==='line')){const p=e.shiftKey?snapEndpoint(drag.end==='p1'?a.x2:a.x1,drag.end==='p1'?a.y2:a.y1,x,y,bounds):{x,y};updateAnnotation(drag.id, drag.end === 'p1' ? { x1: p.x, y1: p.y } : { x2: p.x, y2: p.y })}
    } else if(drag.mode==='curve-control'){
      const a=page.annotations.find(a=>a.id===drag.id);if(a?.kind==='arrow')updateAnnotation(drag.id,{control:controlFromBend(a,x,y)})
    } else if(drag.mode==='callout-tail'){
      updateAnnotation(drag.id,{tail:{x:clamp(x,0,bounds.w),y:clamp(y,0,bounds.h)}})
    } else if (drag.mode === 'resize') {
      const r = resizeRect(drag.snapshot, drag.handle, x, y, bounds, 8)
      updateAnnotation(drag.id, { x: r.x, y: r.y, w: r.w, h: r.h })
    } else if (drag.mode === 'crop-handle') {
      setCropRect(resizeRect(drag.snapshot, drag.handle, x, y, bounds, 20))
    } else if (drag.mode === 'crop-move') {
      setCropRect({
        ...drag.snapshot,
        x: clamp(drag.snapshot.x + x - drag.startX, 0, bounds.w - drag.snapshot.w),
        y: clamp(drag.snapshot.y + y - drag.startY, 0, bounds.h - drag.snapshot.h),
      })
    } else if (drag.mode === 'crop-draw') {
      setCropRect(drawingRect(drag.startX,drag.startY,x,y,bounds,e.shiftKey))
    } else if (drag.mode === 'move') {
      const moved = new Map(drag.snapshot.map(a => [a.id, translateAnnotation(a, x - drag.startX, y - drag.startY)]))
      onChange(page.annotations.map(a => a.locked || a.hidden ? a : moved.get(a.id) ?? a))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if(drag?.mode==='freehand'){
      if(drag.frame!==undefined)cancelAnimationFrame(drag.frame)
      if(e.type==='pointerup'){const p=toNatural(e),last=drag.points.at(-1)!;if(Math.hypot(p.x-last.x,p.y-last.y)>.01)drag.points.push(p)}
      if(drag.points.length<2){onChange(annotationsRef.current.filter(a=>a.id!==drag.id));onSelect(null)}else updateAnnotation(drag.id,{points:simplifyStroke(drag.points)})
    }
    if (drag?.mode === 'create') {
      const ann = page.annotations.find((a) => a.id === drag.id)
      if (ann && 'w' in ann && 'h' in ann && (ann.w < 8 || ann.h < 8)) {
        onChange(page.annotations.filter((a) => a.id !== drag.id))
        onSelect(null)
      } else if (ann?.kind === 'callout') {
        // pointerup 后再聚焦，避免创建手势末尾的 click 立即让输入区失焦。
        requestAnimationFrame(() => beginTextEdit(ann.id, ''))
      }
    }
    if (drag?.mode === 'arrow-end') {
      const ann = page.annotations.find((a) => a.id === drag.id)
      if (ann && (ann.kind === 'arrow' || ann.kind === 'line') && Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) < 12) {
        onChange(page.annotations.filter((a) => a.id !== drag.id))
        onSelect(null)
      }
    }
    dragRef.current = null
  }

  const startResize = (e: React.PointerEvent, ann: Annotation & Rect, handle: ResizeHandle) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragRef.current = { mode: 'resize', id: ann.id, handle, snapshot: { x: ann.x, y: ann.y, w: ann.w, h: ann.h } }
  }

  useAnnotationKeyboard({ page, tool, selectedIds, onChange, onSelectionChange, onResetCrop: () => setCropRect({ x: 0, y: 0, w: page.width, h: page.height }) })

  const numbers = page.annotations.filter((a) => a.kind === 'number' && !a.hidden)
  const numOf = new Map(numbers.map((n, i) => [n.id, i + 1]))
  const handleR = 7 / scale

  const cursor = tool === 'select' ? 'default' : 'crosshair'

  return (
    <div ref={containerRef} className="w-full">
      <div
        className="relative mx-auto leading-none select-none"
        style={{ width: displayW, cursor }}
      >
        <canvas
          ref={baseRef}
          className="block h-auto w-full bg-white shadow-[0_12px_36px_rgba(0,0,0,0.28)] ring-1 ring-black/20"
          style={{ width: displayW, height: page.height * scale }}
        />
        <svg
          viewBox={`0 0 ${page.width} ${page.height}`}
          style={{ width: displayW, height: page.height * scale }}
          className="absolute inset-0 touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={(e) => {
            if (suppressTextClickRef.current) {
              suppressTextClickRef.current = false
              return
            }
            if (TOOL_CATALOG[tool].interaction !== 'text' || editingTextId) return
            const { x, y } = toNatural(e)
            // 文字标注内部保存首行基线；点击位置应对应文字框的左上角。
            setTextPos({ x, y: y + textSize, background: tool === 'text-box' })
            beginTextEdit('__new__', '')
          }}
          onDoubleClick={(e) => {
            if (tool !== 'select') return
            const { x, y } = toNatural(e)
            const hit = hitTest(x, y)
            if (hit?.kind === 'text' || hit?.kind === 'callout') {
              onSelect(hit.id)
              beginTextEdit(hit.id, hit.text)
            }
          }}
        >
          {/* SVG 空白区域默认不接收指针事件；用透明底层保证画布任意位置都能触发工具操作。 */}
          <rect
            x={0}
            y={0}
            width={page.width}
            height={page.height}
            fill="transparent"
            pointerEvents="all"
          />
          {page.annotations.filter(a => !a.hidden).map((original) => {
            const layout = original.kind === 'callout' ? calloutLayout({ ...original, text: editingTextId === original.id ? textDraft : original.text }) : null
            const ann = original.kind === 'callout' && layout ? { ...original, w: layout.w, h: layout.h } : original
            const isSel = selectedIds.includes(ann.id) && !ann.locked
            if (isAreaAnnotation(ann)) {
              return (
                <g key={ann.id}>
                  {renderAreaAnnotation(ann, isSel)}
                  {isSel && ann.kind !== 'mosaic' && (
                    <rect x={ann.x - 4} y={ann.y - 4} width={ann.w + 8} height={ann.h + 8} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" />
                  )}
                  {isSel && selectedIds.length === 1 && <ResizeHandles r={ann} stroke="#2563eb" handleR={handleR} onDown={(e, h) => startResize(e, ann, h)} />}
                </g>
              )
            }
            if (isMarkAnnotation(ann)) {
              return (
                <g key={ann.id}>
                  {<MarkView annotation={ann} selected={isSel} label={numberStart + (numOf.get(ann.id) ?? 1)} handleR={handleR}
                    onEndpointDown={(event, end) => {
                      if (selectedIds.length !== 1 || ann.locked) return
                      event.stopPropagation()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      dragRef.current = { mode: 'arrow-end', id: ann.id, end }
                    }} onCurveDown={event=>{if(selectedIds.length!==1||ann.locked)return;event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);dragRef.current={mode:'curve-control',id:ann.id}}} />}
                </g>
              )
            }
            if (isContentAnnotation(ann)) {
              return (
                <g key={ann.id}>
                  {renderContentAnnotation(editingTextId === ann.id && ann.kind === 'callout' ? { ...ann, text: '' } : editingTextId === ann.id && ann.kind === 'text' ? { ...ann, text: textDraft } : ann, {
                    selected: isSel,
                    scale,
                    magnifierSource,
                    pageWidth: page.width,
                    pageHeight: page.height,
                    editing: editingTextId === ann.id,
                  })}
                  {isSel && ann.kind === 'callout' && (
                    <rect x={ann.x - 4} y={ann.y - 4} width={ann.w + 8} height={ann.h + 8} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" />
                  )}
                  {isSel && selectedIds.length === 1 && ann.kind !== 'text' && <ResizeHandles r={ann} stroke="#2563eb" handleR={handleR} onDown={(e, h) => startResize(e, ann, h)} />}
                  {isSel&&selectedIds.length===1&&ann.kind==='callout'&&(()=>{const tip=calloutTail(ann);return <circle cx={tip.x} cy={tip.y} r={handleR*1.2} fill="#dbeafe" stroke="#2563eb" strokeWidth={2} aria-label="气泡指向点" style={{cursor:'move'}} onPointerDown={event=>{event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);dragRef.current={mode:'callout-tail',id:ann.id}}}/>})()}
                </g>
              )
            }
          })}

          {editingTextId === '__new__' && renderContentAnnotation(createContentAnnotation('text', '__new__', textPos.x, textPos.y, { text: textDraft, color, textSize, background: textPos.background, textStyle: drawingStyle?.text }), { selected: false, editing: true, scale, magnifierSource, pageWidth: page.width, pageHeight: page.height })}
          {/* 裁剪选区：全图初始选区 + 八向手柄 */}
          {cropRect && (
            <g>
              <path
                d={`M0 0 H${page.width} V${page.height} H0 Z M${cropRect.x} ${cropRect.y} h${cropRect.w} v${cropRect.h} h${-cropRect.w} Z`}
                fill="rgba(15,23,42,0.45)"
                fillRule="evenodd"
              />
              <rect
                x={cropRect.x}
                y={cropRect.y}
                width={cropRect.w}
                height={cropRect.h}
                fill="none"
                stroke="#22c55e"
                strokeWidth={2.5}
              />
              {<ResizeHandles r={cropRect} stroke="#16a34a" handleR={handleR} onDown={(e, h) => {
                e.stopPropagation()
                ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
                dragRef.current = { mode: 'crop-handle', handle: h, snapshot: cropRect }
              }} />}
            </g>
          )}
        </svg>

        {/* 裁剪确认/取消操作条 */}
        {tool === 'crop' && cropRect && (
          <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/15 bg-slate-950/90 px-2.5 py-2 text-xs text-white shadow-xl backdrop-blur">
            <span className="px-1 tabular-nums text-slate-300">
              {Math.round(cropRect.w)} × {Math.round(cropRect.h)}
            </span>
            <Button
              size="sm"
              className="h-7 rounded-lg bg-emerald-500 px-2.5 text-xs text-white hover:bg-emerald-400"
              onClick={() => onCrop?.(cropRect)}
            >
              <Check className="size-3.5" />
              完成裁剪
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 rounded-lg bg-slate-700 px-2.5 text-xs text-white hover:bg-slate-600"
              onClick={() => setCropRect({ x: 0, y: 0, w: page.width, h: page.height })}
            >
              <X className="size-3.5" />
              重置
            </Button>
          </div>
        )}

        {/* 输入区覆盖在标注自身，不再出现独立的悬浮编辑框。 */}
        {editingTextId && (
          <textarea
            ref={textInputRef}
            autoFocus
            wrap={editTarget?.kind === 'callout' ? 'soft' : 'off'}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onCompositionStart={() => { composingTextRef.current = true }}
            onCompositionEnd={() => {
              composingTextRef.current = false
              if (commitAfterCompositionRef.current) {
                commitAfterCompositionRef.current = false
                queueMicrotask(commitText)
              }
            }}
            onBlur={() => {
              if (composingTextRef.current) { commitAfterCompositionRef.current = true; return }
              commitText()
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (isComposingKey(e.nativeEvent)) return
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                commitText()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                textCancelRef.current = true
                onTextEditingChange?.(false)
                if (editTarget?.kind === 'callout' && !editTarget.text) {
                  onChange(page.annotations.filter(a => a.id !== editTarget.id))
                  onSelect(null)
                }
                setEditingTextId(null)
                setTextDraft('')
              }
            }}
            placeholder={editTarget?.kind === 'callout' ? '输入说明文字' : '输入文字'}
            aria-label="标注文字编辑区"
            className="absolute z-10 resize-none outline-none placeholder:opacity-60"
            style={editTarget?.kind === 'callout' ? (() => { const layout = calloutLayout({ ...editTarget, text: textDraft }); return {
              left: (editTarget.x + layout.style.padding) * scale,
              top: (editTarget.y + layout.style.padding) * scale,
              width: Math.max(1, layout.w - layout.style.padding * 2) * scale,
              height: Math.max(layout.lineHeight, layout.h - layout.style.padding * 2) * scale,
              padding: 0,
              border: 0,
              background: 'transparent',
              color: layout.style.color ?? editTarget.color,
              font: `${layout.style.weight} ${layout.size * scale}px "PingFang SC", "Microsoft YaHei", sans-serif`,
              lineHeight: `${layout.lineHeight * scale}px`,
              textAlign: layout.style.align,
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
              boxSizing: 'border-box' as const,
            } })() : (() => {
              const size = editTarget?.kind === 'text' ? editTarget.size ?? 26 : textSize
              const x = editTarget?.kind === 'text' ? editTarget.x : textPos.x
              const y = editTarget?.kind === 'text' ? editTarget.y : textPos.y
              const background = editTarget?.kind === 'text' ? editTarget.background : textPos.background
              const layout = textLayout({ x, y, text: textDraft, size, background, textStyle: editTarget?.kind === 'text' ? editTarget.textStyle : drawingStyle?.text })
              return {
                left: x * scale,
                top: layout.top * scale,
                width: layout.textWidth * scale,
                height: layout.lines.length * layout.lineHeight * scale,
                padding: 0,
                border: 0,
                background: 'transparent',
                color: editTarget?.kind === 'text' ? editTarget.color : color,
                font: `${layout.style.weight} ${size * scale}px "PingFang SC", "Microsoft YaHei", sans-serif`,
                lineHeight: `${layout.lineHeight * scale}px`,
                textAlign: layout.style.align,
                boxSizing: 'border-box' as const,
                textShadow: layout.style.outline ? `${scale}px ${scale}px #fff, -${scale}px -${scale}px #fff` : 'none',
                outline: '1px dashed #3b82f6',
              }
            })()}
          />
        )}
      </div>

    </div>
  )
}

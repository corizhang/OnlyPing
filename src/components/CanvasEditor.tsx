import { hitArea, isAreaAnnotation, renderAreaAnnotation } from '@/lib/tools/area'
import { createAnnotation } from '@/lib/tools'
import { hitMark, isMarkAnnotation, renderMarkAnnotation } from '@/lib/tools/mark'
import { createContentAnnotation, hitContent, isContentAnnotation, renderContentAnnotation } from '@/lib/tools/content'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Annotation, Page, Rect, Tool } from '@/types'
import { loadImage, mosaicCanvasRegion, renderPageToCanvas } from '@/lib/render'
import { MOSAIC_DEFAULT_TILE, uid } from '@/types'

interface Props {
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
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (annotations: Annotation[]) => void
  onZoomChange?: (zoom: number) => void
  onCrop?: (rect: Rect) => void
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type DragState =
  | { mode: 'create'; kind: 'box' | 'ellipse' | 'highlight' | 'redact' | 'mosaic' | 'callout' | 'magnifier'; startX: number; startY: number; id: string }
  | { mode: 'freehand'; id: string }
  | { mode: 'move'; id: string; startX: number; startY: number; snapshot: Annotation }
  | { mode: 'resize'; id: string; handle: ResizeHandle; snapshot: Rect }
  | { mode: 'arrow-end'; id: string; end: 'p1' | 'p2' }
  | { mode: 'crop-handle'; handle: ResizeHandle; snapshot: Rect }
  | { mode: 'crop-move'; startX: number; startY: number; snapshot: Rect }
  | { mode: 'crop-draw'; startX: number; startY: number }

const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

const handlePos = (r: Rect, h: ResizeHandle) => {
  switch (h) {
    case 'nw':
      return { x: r.x, y: r.y }
    case 'n':
      return { x: r.x + r.w / 2, y: r.y }
    case 'ne':
      return { x: r.x + r.w, y: r.y }
    case 'e':
      return { x: r.x + r.w, y: r.y + r.h / 2 }
    case 'se':
      return { x: r.x + r.w, y: r.y + r.h }
    case 's':
      return { x: r.x + r.w / 2, y: r.y + r.h }
    case 'sw':
      return { x: r.x, y: r.y + r.h }
    case 'w':
      return { x: r.x, y: r.y + r.h / 2 }
  }
}

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 根据拖拽点和对侧固定的手柄，计算新矩形（钳制在图内，不小于 minSize） */
function resizeRect(s: Rect, handle: ResizeHandle, px: number, py: number, bounds: { w: number; h: number }, minSize: number): Rect {
  let { x, y, w, h } = s
  const x2 = s.x + s.w
  const y2 = s.y + s.h
  if (handle === 'e' || handle === 'se' || handle === 'ne') w = clamp(px, s.x + minSize, bounds.w) - s.x
  if (handle === 'w' || handle === 'sw' || handle === 'nw') {
    const nx = clamp(px, 0, x2 - minSize)
    w = x2 - nx
    x = nx
  }
  if (handle === 's' || handle === 'se' || handle === 'sw') h = clamp(py, s.y + minSize, bounds.h) - s.y
  if (handle === 'n' || handle === 'ne' || handle === 'nw') {
    const ny = clamp(py, 0, y2 - minSize)
    h = y2 - ny
    y = ny
  }
  return { x, y, w, h }
}

export default function CanvasEditor({ page, tool, color, zoom, numberStart, mosaicTile, numberR, textSize, strokeWidth, selectedId, onSelect, onChange, onZoomChange, onCrop }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const baseImageRef = useRef<HTMLImageElement | null>(null)
  const mosaicsRef = useRef<Extract<Annotation, { kind: 'mosaic' }>[]>([])
  const redactsRef = useRef<Extract<Annotation, { kind: 'redact' }>[]>([])
  const [magnifierSource, setMagnifierSource] = useState('')
  const scale = zoom
  const displayW = page.width * zoom
  const dragRef = useRef<DragState | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const textPosRef = useRef({ x: 0, y: 0, background: false })
  const [cropRect, setCropRect] = useState<Rect | null>(null)

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
      setCropRect({ x: 0, y: 0, w: page.width, h: page.height })
    } else {
      setCropRect(null)
    }
  }, [tool, page.id, page.width, page.height])

  // 底图只在图片或尺寸变化时载入，避免拖动普通标注时反复清空并重绘图片。
  const mosaics = page.annotations.filter(
    (ann): ann is Extract<Annotation, { kind: 'mosaic' }> => ann.kind === 'mosaic'
  )
  const redacts = page.annotations.filter(
    (ann): ann is Extract<Annotation, { kind: 'redact' }> => ann.kind === 'redact'
  )
  mosaicsRef.current = mosaics
  redactsRef.current = redacts
  const hasMagnifier = page.annotations.some((ann) => ann.kind === 'magnifier')
  const mosaicKey = [...mosaics, ...redacts]
    .map((ann) => `${ann.id}:${ann.x}:${ann.y}:${ann.w}:${ann.h}:${ann.kind === 'mosaic' ? ann.tile ?? MOSAIC_DEFAULT_TILE : ann.color}`)
    .join('|')

  const drawBase = useCallback((img: HTMLImageElement) => {
    const canvas = baseRef.current
    if (!canvas) return
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
  }, [page.width, page.height])

  useEffect(() => {
    if (!hasMagnifier) {
      setMagnifierSource('')
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      const sourcePage = { ...page, annotations: page.annotations.filter((ann) => ann.kind !== 'magnifier') }
      void renderPageToCanvas(sourcePage).then((canvas) => {
        if (!cancelled) setMagnifierSource(canvas.toDataURL())
      }).catch(() => undefined)
    }, 100)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [hasMagnifier, page.image, page.annotations])

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
      onChange(page.annotations.map((a) => (a.id === id ? ({ ...a, ...patch } as Annotation) : a)))
    },
    [page.annotations, onChange]
  )

  const commitText = useCallback(() => {
    const text = textDraft.trim()
    const editing = page.annotations.find((a) => a.id === editingTextId)
    if (editing && (editing.kind === 'text' || editing.kind === 'callout')) {
      if (text) updateAnnotation(editing.id, { text })
      else onChange(page.annotations.filter((a) => a.id !== editing.id))
    } else if (text) {
      const ann = createContentAnnotation('text', uid(), textPosRef.current.x, textPosRef.current.y, {
        text, color, textSize, background: textPosRef.current.background,
      })
      onChange([...page.annotations, ann])
      onSelect(ann.id)
    }
    setEditingTextId(null)
    setTextDraft('')
  }, [textDraft, editingTextId, page.annotations, color, textSize, onChange, onSelect, updateAnnotation])

  const onPointerDown = (e: React.PointerEvent) => {
    if (editingTextId) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    const { x, y } = toNatural(e)

    if (tool === 'select') {
      const hit = hitTest(x, y)
      if (hit) {
        onSelect(hit.id)
        dragRef.current = { mode: 'move', id: hit.id, startX: x, startY: y, snapshot: hit }
      } else {
        onSelect(null)
      }
      return
    }

    if (tool === 'number' || tool === 'arrow' || tool === 'line' || tool === 'freehand') {
      const ann = createAnnotation(tool, x, y, { color, numberR, mosaicTile, strokeWidth })
      onChange([...page.annotations, ann])
      onSelect(ann.id)
      if (tool === 'arrow' || tool === 'line') dragRef.current = { mode: 'arrow-end', id: ann.id, end: 'p2' }
      if (tool === 'freehand') dragRef.current = { mode: 'freehand', id: ann.id }
      return
    }

    if (tool === 'text' || tool === 'text-box') {
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
    const ann = createAnnotation(tool as 'box' | 'ellipse' | 'highlight' | 'redact' | 'callout' | 'magnifier' | 'mosaic', x, y, { color, numberR, mosaicTile, strokeWidth })
    onChange([...page.annotations, ann])
    onSelect(ann.id)
    dragRef.current = { mode: 'create', kind: tool, startX: x, startY: y, id: ann.id }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const { x, y } = toNatural(e)
    const bounds = { w: page.width, h: page.height }

    if (drag.mode === 'create') {
      const rx = Math.min(drag.startX, x)
      const ry = Math.min(drag.startY, y)
      updateAnnotation(drag.id, { x: rx, y: ry, w: Math.abs(x - drag.startX), h: Math.abs(y - drag.startY) })
    } else if (drag.mode === 'freehand') {
      const current = page.annotations.find((ann) => ann.id === drag.id)
      if (current?.kind === 'freehand') {
        const last = current.points[current.points.length - 1]
        if (!last || Math.hypot(last.x - x, last.y - y) >= 2) updateAnnotation(drag.id, { points: [...current.points, { x, y }] })
      }
    } else if (drag.mode === 'arrow-end') {
      updateAnnotation(drag.id, drag.end === 'p1' ? { x1: x, y1: y } : { x2: x, y2: y })
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
      const rx = clamp(Math.min(drag.startX, x), 0, bounds.w)
      const ry = clamp(Math.min(drag.startY, y), 0, bounds.h)
      setCropRect({
        x: rx,
        y: ry,
        w: clamp(Math.abs(x - drag.startX), 0, bounds.w - rx),
        h: clamp(Math.abs(y - drag.startY), 0, bounds.h - ry),
      })
    } else if (drag.mode === 'move') {
      const s = drag.snapshot
      if (s.kind === 'number' || s.kind === 'text') {
        updateAnnotation(drag.id, { x: s.x + x - drag.startX, y: s.y + y - drag.startY })
      } else if (s.kind === 'arrow' || s.kind === 'line') {
        const dx = x - drag.startX
        const dy = y - drag.startY
        updateAnnotation(drag.id, { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy })
      } else if (s.kind === 'freehand') {
        const dx = x - drag.startX
        const dy = y - drag.startY
        updateAnnotation(drag.id, { points: s.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) })
      } else {
        updateAnnotation(drag.id, {
          x: s.x + x - drag.startX,
          y: s.y + y - drag.startY,
          w: s.w,
          h: s.h,
        })
      }
    }
  }

  const onPointerUp = () => {
    const drag = dragRef.current
    if (drag?.mode === 'create') {
      const ann = page.annotations.find((a) => a.id === drag.id)
      if (ann && (ann.kind === 'box' || ann.kind === 'ellipse' || ann.kind === 'highlight' || ann.kind === 'redact' || ann.kind === 'mosaic' || ann.kind === 'callout' || ann.kind === 'magnifier') && (ann.w < 8 || ann.h < 8)) {
        onChange(page.annotations.filter((a) => a.id !== drag.id))
        onSelect(null)
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

  // 键盘：删除选中标注；Escape 取消裁剪选区或取消选择；方向键微移（Shift=10px）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (e.defaultPrevented || target.closest('input,textarea,select,[role=slider],[role=separator],[role=tab],[role=menuitem]') || target.isContentEditable) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && tool !== 'crop') {
        onChange(page.annotations.filter((a) => a.id !== selectedId))
        onSelect(null)
      }
      if (e.key === 'Escape') {
        if (tool === 'crop') setCropRect({ x: 0, y: 0, w: page.width, h: page.height })
        else onSelect(null)
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && selectedId) {
        const ann = page.annotations.find((a) => a.id === selectedId)
        if (ann) {
          e.preventDefault()
          let copy: Annotation = { ...ann, id: uid() }
          if (ann.kind === 'arrow' || ann.kind === 'line') copy = { ...ann, id: uid(), x1: ann.x1 + 16, y1: ann.y1 + 16, x2: ann.x2 + 16, y2: ann.y2 + 16 }
          else if (ann.kind === 'freehand') copy = { ...ann, id: uid(), points: ann.points.map((point) => ({ x: point.x + 16, y: point.y + 16 })) }
          else copy = { ...ann, id: uid(), x: ann.x + 16, y: ann.y + 16 }
          onChange([...page.annotations, copy])
          onSelect(copy.id)
        }
      }
      if (e.key.startsWith('Arrow') && selectedId) {
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        if (!dx && !dy) return
        e.preventDefault()
        const ann = page.annotations.find((a) => a.id === selectedId)
        if (!ann) return
        if (ann.kind === 'arrow' || ann.kind === 'line') {
          updateAnnotation(selectedId, { x1: ann.x1 + dx, y1: ann.y1 + dy, x2: ann.x2 + dx, y2: ann.y2 + dy })
        } else if (ann.kind === 'freehand') {
          updateAnnotation(selectedId, { points: ann.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) })
        } else {
          updateAnnotation(selectedId, { x: ann.x + dx, y: ann.y + dy })
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, tool, page.annotations, page.width, page.height, onChange, onSelect, updateAnnotation])

  const numbers = page.annotations.filter((a) => a.kind === 'number')
  const numOf = new Map(numbers.map((n, i) => [n.id, i + 1]))
  const selected = page.annotations.find((a) => a.id === selectedId)
  const handleR = 7 / scale

  const renderHandles = (r: Rect, stroke: string, onDown: (e: React.PointerEvent, h: ResizeHandle) => void) =>
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

  const cursor = tool === 'select' ? 'default' : 'crosshair'

  return (
    <div ref={containerRef} className="w-full">
      <div
        className="relative mx-auto leading-none select-none"
        style={{ width: displayW, cursor }}
      >
        <canvas
          ref={baseRef}
          className="block h-auto w-full rounded-xl bg-background shadow-lg ring-1 ring-black/5"
          style={{ width: displayW, height: page.height * scale }}
        />
        <svg
          viewBox={`0 0 ${page.width} ${page.height}`}
          style={{ width: displayW, height: page.height * scale }}
          className="absolute inset-0 touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onClick={(e) => {
            if ((tool !== 'text' && tool !== 'text-box') || editingTextId) return
            const { x, y } = toNatural(e)
            textPosRef.current = { x, y, background: tool === 'text-box' }
            setTextDraft('')
            setEditingTextId('__new__')
          }}
          onDoubleClick={(e) => {
            if (tool !== 'select') return
            const { x, y } = toNatural(e)
            const hit = hitTest(x, y)
            if (hit?.kind === 'text' || hit?.kind === 'callout') {
              onSelect(hit.id)
              setTextDraft(hit.text)
              setEditingTextId(hit.id)
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
          {page.annotations.map((ann) => {
            const isSel = ann.id === selectedId
            if (isAreaAnnotation(ann)) {
              return (
                <g key={ann.id}>
                  {renderAreaAnnotation(ann, isSel)}
                  {isSel && ann.kind !== 'mosaic' && (
                    <rect x={ann.x - 4} y={ann.y - 4} width={ann.w + 8} height={ann.h + 8} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" />
                  )}
                  {isSel && renderHandles(ann, '#2563eb', (e, h) => startResize(e, ann, h))}
                </g>
              )
            }
            if (isMarkAnnotation(ann)) {
              return (
                <g key={ann.id}>
                  {renderMarkAnnotation(ann, {
                    selected: isSel,
                    label: numberStart + (numOf.get(ann.id) ?? 1),
                    handleR,
                    onEndpointDown: (event, end) => {
                      event.stopPropagation()
                      event.currentTarget.setPointerCapture(event.pointerId)
                      dragRef.current = { mode: 'arrow-end', id: ann.id, end }
                    },
                  })}
                </g>
              )
            }
            if (isContentAnnotation(ann)) {
              return (
                <g key={ann.id}>
                  {renderContentAnnotation(ann, {
                    selected: isSel,
                    scale,
                    magnifierSource,
                    pageWidth: page.width,
                    pageHeight: page.height,
                  })}
                  {isSel && ann.kind === 'callout' && (
                    <rect x={ann.x - 4} y={ann.y - 4} width={ann.w + 8} height={ann.h + 8} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" />
                  )}
                  {isSel && ann.kind !== 'text' && renderHandles(ann, '#2563eb', (e, h) => startResize(e, ann, h))}
                </g>
              )
            }
          })}

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
              {renderHandles(cropRect, '#16a34a', (e, h) => {
                e.stopPropagation()
                ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
                dragRef.current = { mode: 'crop-handle', handle: h, snapshot: cropRect }
              })}
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

        {/* 文字标注内联编辑器（多行，Enter 换行） */}
        {editingTextId && (
          <Textarea
            autoFocus
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitText()
              if (e.key === 'Escape') {
                setEditingTextId(null)
                setTextDraft('')
              }
            }}
            placeholder="输入说明文字，可 Enter 换行，Ctrl+回车或点击空白处确认"
            rows={Math.min(6, Math.max(2, textDraft.split('\n').length + 1))}
            className="absolute z-10 min-h-0 resize-none border-2 border-primary bg-background/95 px-2 py-1 text-sm leading-snug text-foreground shadow-lg outline-none focus-visible:ring-0"
            style={{
              left: (editingTextId === '__new__' ? textPosRef.current.x : (selected?.kind === 'text' ? selected.x : selected?.kind === 'callout' ? selected.x + 6 : 0)) * scale,
              top: (editingTextId === '__new__' ? textPosRef.current.y : (selected?.kind === 'text' ? selected.y : selected?.kind === 'callout' ? selected.y + 6 : 0)) * scale,
              width: selected?.kind === 'callout' ? Math.max(120, (selected.w - 12) * scale) : 260,
              fontSize: 14,
            }}
          />
        )}
      </div>

      {tool === 'crop' ? (
        <div className="mt-2 text-xs text-emerald-600">
          拖动四角/四边或整体移动选区，调整好后点击画布下方的「完成裁剪」；在选区外拖拽可重新框选（Esc 重置选区）
        </div>
      ) : (
        selected && (
          <div className="mt-2 text-xs text-slate-500">
            已选中
            {selected.kind === 'box'
              ? '画框'
              : selected.kind === 'ellipse'
                ? '椭圆'
                : selected.kind === 'highlight'
                  ? '高亮'
                  : selected.kind === 'redact'
                    ? '遮挡'
                    : selected.kind === 'mosaic'
                ? '打码区域'
                : selected.kind === 'number'
                  ? `序号 ${numberStart + (numOf.get(selected.id) ?? 1)}`
                    : selected.kind === 'arrow'
                      ? '箭头'
                      : selected.kind === 'line'
                        ? '直线'
                        : selected.kind === 'freehand'
                          ? '自由画笔'
                          : selected.kind === 'callout'
                            ? '说明气泡'
                          : selected.kind === 'magnifier'
                            ? '局部放大'
                            : selected.kind === 'text' && selected.background ? '文字框' : '文字'}
            ，可拖动位置或四角/四边调整大小，Ctrl+D 复制，Delete 删除
          </div>
        )
      )}
    </div>
  )
}

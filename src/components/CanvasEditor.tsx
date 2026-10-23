import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import type { Annotation, Page, Rect, Tool } from '@/types'
import { loadImage, mosaicCanvasRegion } from '@/lib/render'
import { ARROW_DEFAULT_WIDTH, uid } from '@/types'

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
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (annotations: Annotation[]) => void
  onZoomChange?: (zoom: number) => void
  onCrop?: (rect: Rect) => void
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type DragState =
  | { mode: 'create'; kind: 'box' | 'mosaic'; startX: number; startY: number; id: string }
  | { mode: 'move'; id: string; startX: number; startY: number; snapshot: Annotation }
  | { mode: 'resize'; id: string; handle: ResizeHandle; snapshot: Rect }
  | { mode: 'arrow-end'; id: string; end: 'p1' | 'p2' }
  | { mode: 'crop-handle'; handle: ResizeHandle; snapshot: Rect }
  | { mode: 'crop-move'; startX: number; startY: number; snapshot: Rect }
  | { mode: 'crop-draw'; startX: number; startY: number }

const BADGE_R = 20 // 序号圆半径（原始坐标）
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

/** 点到线段的距离 */
const distToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1)
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** 箭头头部三角形的三个顶点（尖端 + 两个底角） */
export const arrowHeadPoints = (x1: number, y1: number, x2: number, y2: number, width: number) => {
  const ang = Math.atan2(y2 - y1, x2 - x1)
  const len = width * 3.2
  const half = width * 1.7
  const bx = x2 - len * Math.cos(ang)
  const by = y2 - len * Math.sin(ang)
  const nx = -Math.sin(ang)
  const ny = Math.cos(ang)
  return `${x2},${y2} ${bx + half * nx},${by + half * ny} ${bx - half * nx},${by - half * ny}`
}

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

export default function CanvasEditor({ page, tool, color, zoom, numberStart, mosaicTile, numberR, textSize, selectedId, onSelect, onChange, onZoomChange, onCrop }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const baseRef = useRef<HTMLCanvasElement>(null)
  const [scale, setScale] = useState(1)
  const [displayW, setDisplayW] = useState(0)
  const dragRef = useRef<DragState | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const textPosRef = useRef({ x: 0, y: 0 })
  const [cropRect, setCropRect] = useState<Rect | null>(null)

  // 容器尺寸 → 缩放（zoom 为额外倍率，Ctrl+滚轮可调）
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth * zoom
      setDisplayW(w)
      setScale(w / page.width)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [page.width, zoom])

  // Ctrl + 滚轮缩放
  useEffect(() => {
    const el = containerRef.current
    if (!el || !onZoomChange) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const next = zoom * (e.deltaY < 0 ? 1.1 : 0.9)
      onZoomChange(Math.min(3, Math.max(0.2, next)))
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

  // 绘制底层画布：图片 + 马赛克
  useEffect(() => {
    const canvas = baseRef.current
    if (!canvas) return
    let cancelled = false
    loadImage(page.image).then((img) => {
      if (cancelled) return
      canvas.width = page.width
      canvas.height = page.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      for (const ann of page.annotations) {
        if (ann.kind === 'mosaic') {
          mosaicCanvasRegion(canvas, Math.round(ann.x), Math.round(ann.y), Math.round(ann.w), Math.round(ann.h), ann.tile)
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [page])

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
        if (ann.kind === 'number') {
          const r = ann.r ?? BADGE_R
          const dx = x - ann.x
          const dy = y - ann.y
          if (dx * dx + dy * dy <= r * r) return ann
        } else if (ann.kind === 'arrow') {
          const w = ann.width ?? ARROW_DEFAULT_WIDTH
          if (distToSegment(x, y, ann.x1, ann.y1, ann.x2, ann.y2) <= Math.max(10, w)) return ann
        } else if (ann.kind === 'text') {
          const size = ann.size ?? 26
          const lineH = Math.round(size * 1.3)
          const maxLen = Math.max(...ann.text.split('\n').map((l) => l.length), 1)
          const lines = ann.text.split('\n').length
          if (
            x >= ann.x - 4 &&
            x <= ann.x + maxLen * size + 12 &&
            y >= ann.y - 6 &&
            y <= ann.y + lines * lineH + 16
          )
            return ann
        } else {
          const pad = 4
          if (x >= ann.x - pad && x <= ann.x + ann.w + pad && y >= ann.y - pad && y <= ann.y + ann.h + pad)
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
    if (editing && editing.kind === 'text') {
      if (text) updateAnnotation(editing.id, { text })
      else onChange(page.annotations.filter((a) => a.id !== editing.id))
    } else if (text) {
      const ann: Annotation = {
        id: uid(),
        kind: 'text',
        x: textPosRef.current.x,
        y: textPosRef.current.y,
        text,
        color,
        size: textSize,
      }
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

    if (tool === 'number') {
      const ann: Annotation = { id: uid(), kind: 'number', x, y, r: numberR }
      onChange([...page.annotations, ann])
      onSelect(ann.id)
      return
    }

    if (tool === 'arrow') {
      const ann: Annotation = { id: uid(), kind: 'arrow', x1: x, y1: y, x2: x, y2: y, color, width: ARROW_DEFAULT_WIDTH }
      onChange([...page.annotations, ann])
      onSelect(ann.id)
      dragRef.current = { mode: 'arrow-end', id: ann.id, end: 'p2' }
      return
    }

    if (tool === 'text') {
      textPosRef.current = { x, y }
      setTextDraft('')
      setEditingTextId('__new__')
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

    // box / mosaic：拖拽创建
    const ann: Annotation =
      tool === 'box'
        ? { id: uid(), kind: 'box', x, y, w: 0, h: 0, color }
        : { id: uid(), kind: 'mosaic', x, y, w: 0, h: 0, tile: mosaicTile }
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
      } else if (s.kind === 'arrow') {
        const dx = x - drag.startX
        const dy = y - drag.startY
        updateAnnotation(drag.id, { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy })
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
      if (ann && (ann.kind === 'box' || ann.kind === 'mosaic') && (ann.w < 8 || ann.h < 8)) {
        onChange(page.annotations.filter((a) => a.id !== drag.id))
        onSelect(null)
      }
    }
    if (drag?.mode === 'arrow-end') {
      const ann = page.annotations.find((a) => a.id === drag.id)
      if (ann && ann.kind === 'arrow' && Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) < 12) {
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
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && tool !== 'crop') {
        onChange(page.annotations.filter((a) => a.id !== selectedId))
        onSelect(null)
      }
      if (e.key === 'Escape') {
        if (tool === 'crop') setCropRect({ x: 0, y: 0, w: page.width, h: page.height })
        else onSelect(null)
      }
      if (e.key.startsWith('Arrow') && selectedId) {
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        if (!dx && !dy) return
        e.preventDefault()
        const ann = page.annotations.find((a) => a.id === selectedId)
        if (!ann) return
        if (ann.kind === 'arrow') {
          updateAnnotation(selectedId, { x1: ann.x1 + dx, y1: ann.y1 + dy, x2: ann.x2 + dx, y2: ann.y2 + dy })
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
          className="block w-full h-auto rounded shadow"
          style={{ width: displayW, height: page.height * scale }}
        />
        <svg
          viewBox={`0 0 ${page.width} ${page.height}`}
          style={{ width: displayW, height: page.height * scale }}
          className="absolute inset-0 touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={(e) => {
            if (tool !== 'select') return
            const { x, y } = toNatural(e)
            const hit = hitTest(x, y)
            if (hit?.kind === 'text') {
              onSelect(hit.id)
              setTextDraft(hit.text)
              setEditingTextId(hit.id)
            }
          }}
        >
          {page.annotations.map((ann) => {
            const isSel = ann.id === selectedId
            if (ann.kind === 'box') {
              return (
                <g key={ann.id}>
                  <rect
                    x={ann.x}
                    y={ann.y}
                    width={ann.w}
                    height={ann.h}
                    fill={ann.color + '22'}
                    stroke={ann.color}
                    strokeWidth={4}
                  />
                  {isSel && (
                    <>
                      <rect
                        x={ann.x - 4}
                        y={ann.y - 4}
                        width={ann.w + 8}
                        height={ann.h + 8}
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                      />
                      {renderHandles(ann, '#2563eb', (e, h) => startResize(e, ann, h))}
                    </>
                  )}
                </g>
              )
            }
            if (ann.kind === 'mosaic') {
              return (
                <g key={ann.id}>
                  <rect
                    x={ann.x}
                    y={ann.y}
                    width={ann.w}
                    height={ann.h}
                    fill="transparent"
                    stroke={isSel ? '#2563eb' : 'rgba(37,99,235,0.4)'}
                    strokeWidth={isSel ? 2.5 : 1.5}
                    strokeDasharray="6 4"
                  />
                  {isSel && renderHandles(ann, '#2563eb', (e, h) => startResize(e, ann, h))}
                </g>
              )
            }
            if (ann.kind === 'number') {
              const r = ann.r ?? BADGE_R
              return (
                <g key={ann.id}>
                  <circle
                    cx={ann.x}
                    cy={ann.y}
                    r={r}
                    fill="#ef4444"
                    stroke="#ffffff"
                    strokeWidth={Math.max(3, r / 6)}
                  />
                  <text
                    x={ann.x}
                    y={ann.y + 1}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="#ffffff"
                    fontSize={r}
                    fontWeight={700}
                    fontFamily='"PingFang SC", "Microsoft YaHei", sans-serif'
                    style={{ pointerEvents: 'none' }}
                  >
                    {numberStart + (numOf.get(ann.id) ?? 1)}
                  </text>
                  {isSel && (
                    <circle
                      cx={ann.x}
                      cy={ann.y}
                      r={r + 6}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                    />
                  )}
                </g>
              )
            }
            if (ann.kind === 'arrow') {
              const w = ann.width ?? ARROW_DEFAULT_WIDTH
              const onEndDown = (e: React.PointerEvent, end: 'p1' | 'p2') => {
                e.stopPropagation()
                ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
                dragRef.current = { mode: 'arrow-end', id: ann.id, end }
              }
              return (
                <g key={ann.id}>
                  <line
                    x1={ann.x1}
                    y1={ann.y1}
                    x2={ann.x2}
                    y2={ann.y2}
                    stroke={ann.color}
                    strokeWidth={w}
                    strokeLinecap="round"
                  />
                  <polygon points={arrowHeadPoints(ann.x1, ann.y1, ann.x2, ann.y2, w)} fill={ann.color} />
                  {isSel && (
                    <>
                      <line
                        x1={ann.x1}
                        y1={ann.y1}
                        x2={ann.x2}
                        y2={ann.y2}
                        stroke="#2563eb"
                        strokeWidth={2}
                        strokeDasharray="5 4"
                        pointerEvents="none"
                      />
                      <circle
                        cx={ann.x1}
                        cy={ann.y1}
                        r={handleR * 1.2}
                        fill="#ffffff"
                        stroke="#2563eb"
                        strokeWidth={2}
                        style={{ cursor: 'move' }}
                        onPointerDown={(e) => onEndDown(e, 'p1')}
                      />
                      <circle
                        cx={ann.x2}
                        cy={ann.y2}
                        r={handleR * 1.2}
                        fill="#ffffff"
                        stroke="#2563eb"
                        strokeWidth={2}
                        style={{ cursor: 'move' }}
                        onPointerDown={(e) => onEndDown(e, 'p2')}
                      />
                    </>
                  )}
                </g>
              )
            }
            // text
            const textSize = ann.size ?? 26
            const textLines = ann.text.split('\n')
            const lineH = Math.round(textSize * 1.3)
            const maxLen = Math.max(...textLines.map((l) => l.length), 1)
            return (
              <g key={ann.id}>
                <text
                  x={ann.x}
                  y={ann.y}
                  fontSize={textSize}
                  fontWeight={700}
                  fill={ann.color}
                  stroke="rgba(255,255,255,0.95)"
                  strokeWidth={Math.max(4, textSize / 4)}
                  paintOrder="stroke"
                  fontFamily='"PingFang SC", "Microsoft YaHei", sans-serif'
                >
                  {textLines.map((line, i) => (
                    <tspan key={i} x={ann.x} dy={i === 0 ? 0 : lineH}>
                      {line}
                    </tspan>
                  ))}
                </text>
                {isSel && (
                  <rect
                    x={ann.x - 4}
                    y={ann.y - 6}
                    width={maxLen * textSize + 12}
                    height={textLines.length * lineH + 16}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                  />
                )}
              </g>
            )
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
          <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-900/85 px-3 py-1.5 text-xs text-white shadow-lg">
            <span className="tabular-nums text-slate-300">
              {Math.round(cropRect.w)} × {Math.round(cropRect.h)}
            </span>
            <button
              className="flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 font-medium hover:bg-emerald-400"
              onClick={() => onCrop?.(cropRect)}
            >
              <Check className="h-3.5 w-3.5" />
              完成裁剪
            </button>
            <button
              className="flex items-center gap-1 rounded-full bg-slate-600 px-2.5 py-1 hover:bg-slate-500"
              onClick={() => setCropRect({ x: 0, y: 0, w: page.width, h: page.height })}
            >
              <X className="h-3.5 w-3.5" />
              重置
            </button>
          </div>
        )}

        {/* 文字标注内联编辑器（多行，Enter 换行） */}
        {editingTextId && (
          <textarea
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
            className="absolute z-10 resize-none rounded border-2 border-blue-600 bg-white px-2 py-1 text-sm leading-snug text-gray-900 shadow-lg outline-none"
            style={{
              left: (editingTextId === '__new__' ? textPosRef.current.x : (selected?.kind === 'text' ? selected.x : 0)) * scale,
              top: (editingTextId === '__new__' ? textPosRef.current.y : (selected?.kind === 'text' ? selected.y : 0)) * scale,
              width: 260,
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
              : selected.kind === 'mosaic'
                ? '打码区域'
                : selected.kind === 'number'
                  ? `序号 ${numberStart + (numOf.get(selected.id) ?? 1)}`
                  : selected.kind === 'arrow'
                    ? '箭头'
                    : '文字'}
            ，可拖动位置或四角/四边调整大小，Delete 删除
          </div>
        )
      )}
    </div>
  )
}

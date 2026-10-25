import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Annotation, Page, Rect, Tool } from '@/types'
import { loadImage, mosaicCanvasRegion, renderPageToCanvas } from '@/lib/render'
import { ARROW_DEFAULT_WIDTH, MOSAIC_DEFAULT_TILE, uid } from '@/types'

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
  | { mode: 'create'; kind: 'box' | 'ellipse' | 'highlight' | 'redact' | 'mosaic' | 'callout' | 'magnifier'; startX: number; startY: number; id: string }
  | { mode: 'freehand'; id: string }
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
  const baseImageRef = useRef<HTMLImageElement | null>(null)
  const mosaicsRef = useRef<Extract<Annotation, { kind: 'mosaic' }>[]>([])
  const redactsRef = useRef<Extract<Annotation, { kind: 'redact' }>[]>([])
  const [magnifierSource, setMagnifierSource] = useState('')
  const [scale, setScale] = useState(1)
  const [displayW, setDisplayW] = useState(0)
  const dragRef = useRef<DragState | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState('')
  const textPosRef = useRef({ x: 0, y: 0, background: false })
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
        if (ann.kind === 'number') {
          const r = ann.r ?? BADGE_R
          const dx = x - ann.x
          const dy = y - ann.y
          if (dx * dx + dy * dy <= r * r) return ann
        } else if (ann.kind === 'arrow') {
          const w = ann.width ?? ARROW_DEFAULT_WIDTH
          if (distToSegment(x, y, ann.x1, ann.y1, ann.x2, ann.y2) <= Math.max(10, w)) return ann
        } else if (ann.kind === 'line') {
          if (distToSegment(x, y, ann.x1, ann.y1, ann.x2, ann.y2) <= Math.max(10, ann.width ?? 4)) return ann
        } else if (ann.kind === 'freehand') {
          if (ann.points.some((point, i) => i > 0 && distToSegment(x, y, ann.points[i - 1].x, ann.points[i - 1].y, point.x, point.y) <= Math.max(10, ann.width ?? 4))) return ann
        } else if (ann.kind === 'text' || ann.kind === 'callout') {
          if (ann.kind === 'callout') {
            if (x >= ann.x - 6 && x <= ann.x + ann.w + 6 && y >= ann.y - 8 && y <= ann.y + ann.h + 10) return ann
            continue
          }
          const size = ann.size ?? 26
          const lineH = Math.round(size * 1.3)
          const maxLen = Math.max(...ann.text.split('\n').map((l) => l.length), 1)
          const lines = ann.text.split('\n').length
          const padX = ann.background ? 12 : 4
          const top = ann.background ? ann.y - size - 6 : ann.y - 6
          if (
            x >= ann.x - padX &&
            x <= ann.x + maxLen * size + padX &&
            y >= top &&
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
    if (editing && (editing.kind === 'text' || editing.kind === 'callout')) {
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
        background: textPosRef.current.background,
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

    if (tool === 'line') {
      const ann: Annotation = { id: uid(), kind: 'line', x1: x, y1: y, x2: x, y2: y, color, width: 4 }
      onChange([...page.annotations, ann])
      onSelect(ann.id)
      dragRef.current = { mode: 'arrow-end', id: ann.id, end: 'p2' }
      return
    }

    if (tool === 'freehand') {
      const ann: Annotation = { id: uid(), kind: 'freehand', points: [{ x, y }], color, width: 4 }
      onChange([...page.annotations, ann])
      onSelect(ann.id)
      dragRef.current = { mode: 'freehand', id: ann.id }
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
    const id = uid()
    const ann: Annotation = tool === 'box'
      ? { id, kind: 'box', x, y, w: 0, h: 0, color }
      : tool === 'ellipse'
        ? { id, kind: 'ellipse', x, y, w: 0, h: 0, color }
        : tool === 'highlight'
          ? { id, kind: 'highlight', x, y, w: 0, h: 0, color }
      : tool === 'redact'
            ? { id, kind: 'redact', x, y, w: 0, h: 0, color: '#111827' }
            : tool === 'callout'
              ? { id, kind: 'callout', x, y, w: 0, h: 0, text: '双击编辑说明', color }
              : tool === 'magnifier'
                ? { id, kind: 'magnifier', x, y, w: 0, h: 0, zoom: 2.5 }
              : { id, kind: 'mosaic', x, y, w: 0, h: 0, tile: mosaicTile }
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
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
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
            if (ann.kind === 'ellipse' || ann.kind === 'highlight' || ann.kind === 'redact') {
              const isEllipse = ann.kind === 'ellipse'
              const isHighlight = ann.kind === 'highlight'
              return (
                <g key={ann.id}>
                  {isEllipse ? (
                    <ellipse cx={ann.x + ann.w / 2} cy={ann.y + ann.h / 2} rx={ann.w / 2} ry={ann.h / 2} fill="none" stroke={ann.color} strokeWidth={4} />
                  ) : (
                    <rect x={ann.x} y={ann.y} width={ann.w} height={ann.h}
                      fill={isHighlight ? ann.color : ann.color}
                      fillOpacity={isHighlight ? 0.38 : 1}
                      stroke={isHighlight ? 'none' : ann.color} strokeWidth={isHighlight ? 0 : 1} />
                  )}
                  {isSel && <>
                    <rect x={ann.x - 4} y={ann.y - 4} width={ann.w + 8} height={ann.h + 8} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" />
                    {renderHandles(ann, '#2563eb', (e, h) => startResize(e, ann, h))}
                  </>}
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
            if (ann.kind === 'arrow' || ann.kind === 'line') {
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
                  {ann.kind === 'arrow' && <polygon points={arrowHeadPoints(ann.x1, ann.y1, ann.x2, ann.y2, w)} fill={ann.color} />}
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
            if (ann.kind === 'freehand') {
              const points = ann.points.map((point) => `${point.x},${point.y}`).join(' ')
              return (
                <g key={ann.id}>
                  <polyline points={points} fill="none" stroke={ann.color} strokeWidth={ann.width ?? 4} strokeLinecap="round" strokeLinejoin="round" />
                  {isSel && <polyline points={points} fill="none" stroke="#2563eb" strokeWidth={Math.max(10, (ann.width ?? 4) + 8)} strokeOpacity={0.18} strokeLinecap="round" strokeLinejoin="round" />}
                </g>
              )
            }
            if (ann.kind === 'callout') {
              const tail = Math.min(18, Math.max(10, ann.w * 0.12))
              const fontSize = Math.max(12, Math.min(18, ann.h * 0.38))
              const charsPerLine = Math.max(1, Math.floor((ann.w - 20) / (fontSize * 0.95)))
              const lines = ann.text.split('\n').flatMap((line) => {
                const chars = Array.from(line)
                return chars.length > charsPerLine
                  ? Array.from({ length: Math.ceil(chars.length / charsPerLine) }, (_, i) => chars.slice(i * charsPerLine, (i + 1) * charsPerLine).join(''))
                  : [line]
              })
              return (
                <g key={ann.id}>
                  <path d={`M${ann.x + 10} ${ann.y} H${ann.x + ann.w - 10} Q${ann.x + ann.w} ${ann.y} ${ann.x + ann.w} ${ann.y + 10} V${ann.y + ann.h - 10} Q${ann.x + ann.w} ${ann.y + ann.h} ${ann.x + ann.w - 10} ${ann.y + ann.h} H${ann.x + tail + 16} L${ann.x + 8} ${ann.y + ann.h + tail} L${ann.x + 12} ${ann.y + ann.h} H${ann.x + 10} Q${ann.x} ${ann.y + ann.h} ${ann.x} ${ann.y + ann.h - 10} V${ann.y + 10} Q${ann.x} ${ann.y} ${ann.x + 10} ${ann.y} Z`} fill="#fff" stroke={ann.color} strokeWidth={2.5} />
                  <text x={ann.x + ann.w / 2} y={ann.y + ann.h / 2 - ((lines.length - 1) * fontSize * 1.25) / 2} textAnchor="middle" dominantBaseline="middle" fill={ann.color} fontSize={fontSize} fontWeight={600} pointerEvents="none">{lines.map((line, i) => <tspan key={i} x={ann.x + ann.w / 2} dy={i === 0 ? 0 : fontSize * 1.25}>{line}</tspan>)}</text>
                  {isSel && <rect x={ann.x - 4} y={ann.y - 4} width={ann.w + 8} height={ann.h + 8} fill="none" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" />}
                  {isSel && renderHandles(ann, '#2563eb', (e, h) => startResize(e, ann, h))}
                </g>
              )
            }
            if (ann.kind === 'magnifier') {
              const zoom = Math.min(4, Math.max(1.2, ann.zoom || 2.5))
              const radius = Math.min(ann.w, ann.h) / 2
              const cx = ann.x + ann.w / 2
              const cy = ann.y + ann.h / 2
              const clipId = `magnifier-${ann.id}`
              return (
                <g key={ann.id}>
                  <defs><clipPath id={clipId}><circle cx={cx} cy={cy} r={radius - 2} /></clipPath></defs>
                  {magnifierSource && <image href={magnifierSource} x={cx * (1 - zoom)} y={cy * (1 - zoom)} width={page.width * zoom} height={page.height * zoom} preserveAspectRatio="none" clipPath={`url(#${clipId})`} />}
                  <circle cx={cx} cy={cy} r={radius - 1} fill="none" stroke="#fff" strokeWidth={6 / scale} />
                  <circle cx={cx} cy={cy} r={radius - 1} fill="none" stroke="#1f2937" strokeOpacity={0.7} strokeWidth={2 / scale} />
                  {isSel && <circle cx={cx} cy={cy} r={radius + 5 / scale} fill="none" stroke="#2563eb" strokeWidth={2 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`} />}
                  {isSel && renderHandles(ann, '#2563eb', (e, h) => startResize(e, ann, h))}
                </g>
              )
            }
            // text
            const textSize = ann.size ?? 26
            const textLines = ann.text.split('\n')
            const lineH = Math.round(textSize * 1.3)
            const maxLen = Math.max(...textLines.map((l) => l.length), 1)
            const textW = maxLen * textSize * 0.65
            const textH = textLines.length * lineH
            return (
              <g key={ann.id}>
                {ann.background && <rect x={ann.x - 6} y={ann.y - textSize - 4} width={textW + 12} height={textH + 10} rx={4} fill="#ffffff" stroke="#d1d5db" strokeWidth={1} />}
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
                    x={ann.x - (ann.background ? 8 : 4)}
                    y={ann.y - (ann.background ? textSize + 6 : 6)}
                    width={textW + (ann.background ? 16 : 12)}
                    height={textH + (ann.background ? 14 : 16)}
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

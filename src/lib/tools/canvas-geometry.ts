import type { Rect } from '@/types'
export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

export const HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export const handlePos = (r: Rect, h: ResizeHandle) => {
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

export const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 根据拖拽点和对侧固定的手柄，计算新矩形（钳制在图内，不小于 minSize） */
export function resizeRect(s: Rect, handle: ResizeHandle, px: number, py: number, bounds: { w: number; h: number }, minSize: number): Rect {
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


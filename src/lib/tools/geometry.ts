const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** 鼠标命中线条和画笔时使用的点到线段距离。 */
export function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / lengthSq, 0, 1)
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

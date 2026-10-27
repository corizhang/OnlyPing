import { useRef } from 'react'
interface Props { label: string; width: number; min: number; max: number; direction: 1 | -1; onChange: (width: number) => void }
export default function PanelResizeHandle({ label, width, min, max, direction, onChange }: Props) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const resize = (value: number) => onChange(Math.max(min, Math.min(max, value)))
  return <div role="separator" aria-label={label} aria-orientation="vertical" aria-valuenow={width} aria-valuemin={min} aria-valuemax={max} tabIndex={0}
    className="z-10 w-1.5 shrink-0 cursor-col-resize touch-none bg-border/40 transition-colors hover:bg-primary/40 focus-visible:bg-primary/50 focus-visible:outline-none"
    onDoubleClick={() => onChange(direction === 1 ? 208 : 288)}
    onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); start.current = { x: e.clientX, width } }}
    onPointerMove={e => { if (start.current) resize(start.current.width + (e.clientX - start.current.x) * direction) }}
    onPointerUp={e => { start.current = null; e.currentTarget.releasePointerCapture(e.pointerId) }}
    onLostPointerCapture={() => { start.current = null }}
    onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); resize(width + (e.key === 'ArrowRight' ? 16 : -16) * direction) } if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); resize(min) } if (e.key === 'End') { e.preventDefault(); e.stopPropagation(); resize(max) } }} />
}

import { MousePointer2, Square, Circle, Highlighter, EyeOff, Hash, ArrowUpRight, Minus, Pencil, MessageSquareQuote, Search, ShieldCheck, Type, TextCursorInput, Crop } from 'lucide-react'
import type { Tool } from '@/types'

const ICONS = { select: MousePointer2, box: Square, ellipse: Circle, highlight: Highlighter, redact: EyeOff, number: Hash, arrow: ArrowUpRight, line: Minus, freehand: Pencil, callout: MessageSquareQuote, magnifier: Search, mosaic: ShieldCheck, text: Type, 'text-box': TextCursorInput, crop: Crop } satisfies Record<Tool, typeof Type>

export default function ToolIcon({ tool, className = 'h-4 w-4' }: { tool: Tool; className?: string }) {
  const Icon = ICONS[tool]
  return <Icon className={className} />
}

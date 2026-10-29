import type { ReactNode } from 'react'
import { numberTool } from './number'
import { arrowTool } from './arrow'
import { lineTool } from './line'
import { freehandTool } from './freehand'
import type { MarkAnnotation, MarkCreationStyle, MarkKind, MarkViewOptions } from './types'

export const markTools = { number: numberTool, arrow: arrowTool, line: lineTool, freehand: freehandTool }
export const isMarkKind = (kind: string): kind is MarkKind => kind in markTools
export const isMarkAnnotation = (annotation: { kind: string }): annotation is MarkAnnotation => isMarkKind(annotation.kind)

export function createMarkAnnotation(kind: MarkKind, id: string, x: number, y: number, style: MarkCreationStyle): MarkAnnotation {
  switch (kind) {
    case 'number': return numberTool.create(id, x, y, style)
    case 'arrow': return arrowTool.create(id, x, y, style)
    case 'line': return lineTool.create(id, x, y, style)
    case 'freehand': return freehandTool.create(id, x, y, style)
  }
}

export function hitMark(annotation: MarkAnnotation, x: number, y: number): boolean {
  switch (annotation.kind) {
    case 'number': return numberTool.hit(annotation, x, y)
    case 'arrow': return arrowTool.hit(annotation, x, y)
    case 'line': return lineTool.hit(annotation, x, y)
    case 'freehand': return freehandTool.hit(annotation, x, y)
  }
}

export function drawMarkAnnotation(ctx: CanvasRenderingContext2D, annotation: MarkAnnotation, label: number): void {
  switch (annotation.kind) {
    case 'number': return numberTool.draw(ctx, annotation, label)
    case 'arrow': return arrowTool.draw(ctx, annotation, label)
    case 'line': return lineTool.draw(ctx, annotation, label)
    case 'freehand': return freehandTool.draw(ctx, annotation, label)
  }
}

function linearSelection(annotation: Extract<MarkAnnotation, { kind: 'arrow' | 'line' }>, options: MarkViewOptions): ReactNode {
  if (!options.selected) return null
  const endpoint = (end: 'p1' | 'p2') => (
    <circle
      cx={end === 'p1' ? annotation.x1 : annotation.x2}
      cy={end === 'p1' ? annotation.y1 : annotation.y2}
      r={options.handleR * 1.2}
      fill="#ffffff"
      stroke="#2563eb"
      strokeWidth={2}
      style={{ cursor: 'move' }}
      onPointerDown={(event) => options.onEndpointDown?.(event, end)}
    />
  )
  return (
    <>
      <line x1={annotation.x1} y1={annotation.y1} x2={annotation.x2} y2={annotation.y2} stroke="#2563eb" strokeWidth={2} strokeDasharray="5 4" pointerEvents="none" />
      {endpoint('p1')}
      {endpoint('p2')}
    </>
  )
}

export function renderMarkAnnotation(annotation: MarkAnnotation, options: MarkViewOptions): ReactNode {
  switch (annotation.kind) {
    case 'number': return numberTool.view(annotation, options)
    case 'arrow': return <>{arrowTool.view(annotation, options)}{linearSelection(annotation, options)}</>
    case 'line': return <>{lineTool.view(annotation, options)}{linearSelection(annotation, options)}</>
    case 'freehand': return freehandTool.view(annotation, options)
  }
}

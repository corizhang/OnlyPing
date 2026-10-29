import type { ReactNode } from 'react'
import { textTool } from './text'
import { calloutTool } from './callout'
import { magnifierTool } from './magnifier'
import type { ContentAnnotation, ContentCreationStyle, ContentKind, ContentViewOptions } from './types'

export const contentTools = { text: textTool, callout: calloutTool, magnifier: magnifierTool }
export const isContentKind = (kind: string): kind is ContentKind => kind in contentTools
export const isContentAnnotation = (annotation: { kind: string }): annotation is ContentAnnotation => isContentKind(annotation.kind)

export function createContentAnnotation(kind: ContentKind, id: string, x: number, y: number, style: ContentCreationStyle): ContentAnnotation {
  switch (kind) {
    case 'text': return textTool.create(id, x, y, style)
    case 'callout': return calloutTool.create(id, x, y, style)
    case 'magnifier': return magnifierTool.create(id, x, y, style)
  }
}

export function hitContent(annotation: ContentAnnotation, x: number, y: number): boolean {
  switch (annotation.kind) {
    case 'text': return textTool.hit(annotation, x, y)
    case 'callout': return calloutTool.hit(annotation, x, y)
    case 'magnifier': return magnifierTool.hit(annotation, x, y)
  }
}

export function drawContentAnnotation(ctx: CanvasRenderingContext2D, annotation: ContentAnnotation, canvas: HTMLCanvasElement): void {
  switch (annotation.kind) {
    case 'text': return textTool.draw(ctx, annotation, canvas)
    case 'callout': return calloutTool.draw(ctx, annotation, canvas)
    case 'magnifier': return magnifierTool.draw(ctx, annotation, canvas)
  }
}

export function renderContentAnnotation(annotation: ContentAnnotation, options: ContentViewOptions): ReactNode {
  switch (annotation.kind) {
    case 'text': return textTool.view(annotation, options)
    case 'callout': return calloutTool.view(annotation, options)
    case 'magnifier': return magnifierTool.view(annotation, options)
  }
}

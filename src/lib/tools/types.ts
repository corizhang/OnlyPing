import type { Annotation, AnnotationStyle } from '@/types'
import type { PointerEvent, ReactNode } from 'react'
export type AreaKind = 'box' | 'ellipse' | 'highlight' | 'redact' | 'mosaic'
export type AreaAnnotation = Extract<Annotation, { kind: AreaKind }>
export type AreaCreationStyle = Pick<AnnotationStyle, 'color' | 'mosaicTile'>
export interface AreaTool<K extends AreaKind> {
  kind: K
  create(id: string, x: number, y: number, style: AreaCreationStyle): Extract<Annotation, { kind: K }>
  hit(annotation: Extract<Annotation, { kind: K }>, x: number, y: number): boolean
  draw(ctx: CanvasRenderingContext2D, annotation: Extract<Annotation, { kind: K }>, canvas: HTMLCanvasElement): void
  view(annotation: Extract<Annotation, { kind: K }>, selected: boolean): ReactNode
}
export const rectHit = (a: { x: number; y: number; w: number; h: number }, x: number, y: number) => x >= a.x - 4 && x <= a.x + a.w + 4 && y >= a.y - 4 && y <= a.y + a.h + 4

export type MarkKind = 'number' | 'arrow' | 'line' | 'freehand'
export type MarkAnnotation = Extract<Annotation, { kind: MarkKind }>
export type MarkCreationStyle = Pick<AnnotationStyle, 'color' | 'numberR' | 'strokeWidth'>

export interface MarkViewOptions {
  selected: boolean
  label: number
  handleR: number
  onEndpointDown?: (event: PointerEvent<SVGCircleElement>, end: 'p1' | 'p2') => void
}

export interface MarkTool<K extends MarkKind> {
  kind: K
  create(id: string, x: number, y: number, style: MarkCreationStyle): Extract<Annotation, { kind: K }>
  hit(annotation: Extract<Annotation, { kind: K }>, x: number, y: number): boolean
  draw(ctx: CanvasRenderingContext2D, annotation: Extract<Annotation, { kind: K }>, label: number): void
  view(annotation: Extract<Annotation, { kind: K }>, options: MarkViewOptions): ReactNode
}

export type ContentKind = 'text' | 'callout' | 'magnifier'
export type ContentAnnotation = Extract<Annotation, { kind: ContentKind }>

export interface ContentCreationStyle {
  color: string
  textSize?: number
  text?: string
  background?: boolean
}

export interface ContentViewOptions {
  selected: boolean
  scale: number
  magnifierSource: string
  pageWidth: number
  pageHeight: number
}

export interface ContentTool<K extends ContentKind> {
  kind: K
  create(id: string, x: number, y: number, style: ContentCreationStyle): Extract<Annotation, { kind: K }>
  hit(annotation: Extract<Annotation, { kind: K }>, x: number, y: number): boolean
  draw(ctx: CanvasRenderingContext2D, annotation: Extract<Annotation, { kind: K }>, canvas: HTMLCanvasElement): void
  view(annotation: Extract<Annotation, { kind: K }>, options: ContentViewOptions): ReactNode
}

import type { Annotation } from '@/types'
import type { ReactNode } from 'react'
import type { AreaAnnotation, AreaCreationStyle } from './types'
import { boxTool } from './box'
import { ellipseTool } from './ellipse'
import { highlightTool } from './highlight'
import { redactTool } from './redact'
import { mosaicTool } from './mosaic'

/** 区域工具共用拖拽、选中框与缩放手柄；各工具负责创建、命中和两种绘制。 */
export const areaTools = { box: boxTool, ellipse: ellipseTool, highlight: highlightTool, redact: redactTool, mosaic: mosaicTool }
export const isAreaKind = (kind: Annotation['kind']): kind is keyof typeof areaTools => kind in areaTools
export const isAreaAnnotation = (annotation: Annotation): annotation is AreaAnnotation => isAreaKind(annotation.kind)

export function createAreaAnnotation(kind: keyof typeof areaTools, id: string, x: number, y: number, style: AreaCreationStyle): Annotation {
  switch (kind) {
    case 'box': return boxTool.create(id, x, y, style)
    case 'ellipse': return ellipseTool.create(id, x, y, style)
    case 'highlight': return highlightTool.create(id, x, y, style)
    case 'redact': return redactTool.create(id, x, y, style)
    case 'mosaic': return mosaicTool.create(id, x, y, style)
  }
}

export function hitArea(annotation: Annotation, x: number, y: number): boolean {
  switch (annotation.kind) {
    case 'box': return boxTool.hit(annotation, x, y)
    case 'ellipse': return ellipseTool.hit(annotation, x, y)
    case 'highlight': return highlightTool.hit(annotation, x, y)
    case 'redact': return redactTool.hit(annotation, x, y)
    case 'mosaic': return mosaicTool.hit(annotation, x, y)
    default: return false
  }
}

export function drawAreaAnnotation(ctx: CanvasRenderingContext2D, annotation: Annotation, canvas: HTMLCanvasElement): void {
  switch (annotation.kind) {
    case 'box': return boxTool.draw(ctx, annotation, canvas)
    case 'ellipse': return ellipseTool.draw(ctx, annotation, canvas)
    case 'highlight': return highlightTool.draw(ctx, annotation, canvas)
    case 'redact': return redactTool.draw(ctx, annotation, canvas)
    case 'mosaic': return mosaicTool.draw(ctx, annotation, canvas)
  }
}

export function renderAreaAnnotation(annotation: Annotation, selected: boolean): ReactNode {
  switch (annotation.kind) {
    case 'box': return boxTool.view(annotation, selected)
    case 'ellipse': return ellipseTool.view(annotation, selected)
    case 'highlight': return highlightTool.view(annotation, selected)
    case 'redact': return redactTool.view(annotation, selected)
    case 'mosaic': return mosaicTool.view(annotation, selected)
    default: return null
  }
}

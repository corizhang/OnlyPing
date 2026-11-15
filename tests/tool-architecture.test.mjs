import test from 'node:test'
import assert from 'node:assert/strict'
import { TOOL_DEFINITIONS, TOOL_CATALOG, TOOL_SHORTCUTS, DEFAULT_TOOL_ORDER } from '../src/lib/tools/catalog.ts'
import { translateAnnotation, duplicateAnnotation, cropAnnotation } from '../src/lib/tools/annotation-geometry.ts'
import { HANDLES, handlePos, resizeRect } from '../src/lib/tools/canvas-geometry.ts'

const annotations = [
  ...['box', 'ellipse', 'highlight', 'redact', 'mosaic', 'callout', 'magnifier'].map(kind => ({ id: kind, kind, x: 20, y: 30, w: 100, h: 80 })),
  ...['text', 'number'].map(kind => ({ id: kind, kind, x: 20, y: 30 })),
  ...['arrow', 'line'].map(kind => ({ id: kind, kind, x1: 20, y1: 30, x2: 70, y2: 90 })),
  { id: 'freehand', kind: 'freehand', points: [{ x: 20, y: 30 }, { x: 50, y: 60 }] },
]

test('every annotation kind has one catalog entry and a unique shortcut', () => {
  for (const annotation of annotations) assert.ok(TOOL_CATALOG[annotation.kind])
  assert.equal(new Set(TOOL_DEFINITIONS.map(t => t.value)).size, TOOL_DEFINITIONS.length)
  assert.equal(new Set(TOOL_DEFINITIONS.map(t => t.shortcut)).size, TOOL_DEFINITIONS.length)
  for (const tool of TOOL_DEFINITIONS) assert.equal(TOOL_SHORTCUTS[tool.shortcut.toLowerCase()], tool.value)
  assert.deepEqual(DEFAULT_TOOL_ORDER, TOOL_DEFINITIONS.map(t => t.value))
})

test('all annotation geometries translate reversibly without changing the source', () => {
  for (const annotation of annotations) {
    const original = structuredClone(annotation)
    const moved = translateAnnotation(annotation, -15, 40)
    assert.deepEqual(translateAnnotation(moved, 15, -40), annotation)
    assert.deepEqual(annotation, original)
  }
})

test('duplicated freehand points are independent of the source', () => {
  const source = annotations.find(a => a.kind === 'freehand')
  const duplicate = duplicateAnnotation(source, 'new-id')
  duplicate.points[0].x = 999
  assert.equal(source.points[0].x, 20)
  assert.equal(duplicate.id, 'new-id')
})

test('cropping keeps lines that cross the selection even with both endpoints outside', () => {
  const result = cropAnnotation({ id: 'line', kind: 'line', x1: 0, y1: 50, x2: 200, y2: 50 }, { x: 50, y: 20, w: 50, h: 60 })
  assert.deepEqual(result, { id: 'line', kind: 'line', x1: -50, y1: 30, x2: 150, y2: 30 })
  assert.equal(cropAnnotation({ id: 'line', kind: 'line', x1: 0, y1: 0, x2: 20, y2: 0 }, { x: 50, y: 20, w: 50, h: 60 }), null)
})

test('rectangle crop intersects bounds and discards empty regions', () => {
  const source = { id: 'box', kind: 'box', x: 20, y: 30, w: 100, h: 80 }
  assert.deepEqual(cropAnnotation(source, { x: 50, y: 50, w: 100, h: 100 }), { ...source, x: 0, y: 0, w: 70, h: 60 })
  assert.equal(cropAnnotation(source, { x: 500, y: 500, w: 100, h: 100 }), null)
})

test('all eight handles preserve geometry when released at their original position', () => {
  const rect = { x: 100, y: 80, w: 200, h: 100 }
  for (const handle of HANDLES) {
    const point = handlePos(rect, handle)
    assert.deepEqual(resizeRect(rect, handle, point.x, point.y, { w: 800, h: 600 }, 8), rect)
  }
  const resized = resizeRect(rect, 'se', 900, 900, { w: 800, h: 600 }, 8)
  assert.equal(resized.x + resized.w, 800)
  assert.equal(resized.y + resized.h, 600)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { shapeAppearance, shapeHit, shapePath, newShapeStyle } from '../src/lib/tools/shape-geometry.ts'
import { arrowGeometry, legacyArrowHead, pointInArrow } from '../src/lib/tools/arrow-geometry.ts'
const box = { id: 'b', kind: 'box', x: 0, y: 0, w: 100, h: 80, color: '#ff0000' }
test('legacy shapes retain their fill while newly created shapes are explicitly outlined', () => {
  assert.equal(shapeAppearance(box).fill, 'solid')
  assert.equal(shapeAppearance(box).fillOpacity, 34 / 255)
  assert.equal(shapeAppearance({ ...box, kind: 'ellipse' }).fill, 'none')
  assert.equal(shapeAppearance({ ...box, style: newShapeStyle() }).fill, 'none')
  assert.equal(shapeAppearance(box).radius, 0, 'legacy canvas appearance is the compatibility baseline')
})
test('shape geometry and hit regions distinguish outlines, fills and ellipse corners', () => {
  const outlined = { ...box, style: newShapeStyle() }
  assert.equal(shapeHit(outlined, 50, 40), false)
  assert.equal(shapeHit(outlined, 0, 40), true)
  assert.equal(shapeHit({ ...outlined, style: { fill: 'solid', fillOpacity: .2 } }, 50, 40), true)
  assert.equal(shapeHit({ ...outlined, kind: 'ellipse' }, 0, 0), false)
  assert.equal(shapeHit({ ...outlined, kind: 'ellipse' }, 50, 0), true)
  assert.equal(shapeHit({ ...outlined, style: { fill: 'solid', strokeStyle: 'none' } }, -2, 40), false)
  assert.match(shapePath({ ...box, style: { radius: 20 } }), /^M20 0 H80 Q100 0 100 20/)
  assert.equal(shapeAppearance({ ...box, w: 10, style: { radius: 40 } }).radius, 5)
  assert.equal(shapePath({ ...box, w: 0 }), '')
})
test('drawing defaults bound corrupt preferences without changing imported legacy objects', () => {
  const style = newShapeStyle({ width: NaN, fillOpacity: 5, radius: -20, strokeStyle: 'unknown', fillColor: 'bad(color)' })
  assert.equal(style.width, 4); assert.equal(style.fillOpacity, 1); assert.equal(style.radius, 0); assert.equal(style.strokeStyle, 'solid'); assert.equal(style.fillColor, undefined)
  assert.equal(newShapeStyle({ strokeStyle: 'none', fill: 'none' }).fill, 'solid')
})
test('modern arrows have finite bounded geometry for short thick, diagonal and reversed arrows', () => {
  for (const arrowStyle of ['standard', 'emphasis']) for (const [x2,y2] of [[12,0],[200,0],[-120,80],[0,-100]]) {
    const a = { id: 'a', kind: 'arrow', x1: 0, y1: 0, x2, y2, width: 16, color: '#f00', arrowStyle }
    const { path, points } = arrowGeometry(a), length = Math.hypot(x2,y2)
    assert.ok(path && !/NaN|Infinity/.test(path))
    for (const p of points) { const projection = (p.x * x2 + p.y * y2) / length; assert.ok(projection >= -1e-8 && projection <= length + 1e-8) }
    assert.deepEqual(points[3], { x: x2, y: y2 }, 'tip remains exactly at endpoint')
    assert.equal(pointInArrow(a, x2 * .8, y2 * .8), true)
  }
  assert.equal(arrowGeometry({ x1: 1, y1: 1, x2: 1, y2: 1 }).path, '')
})
test('emphasis is a distinct contour and arrowhead hit testing includes wings', () => {
  const a = { id: 'a', kind: 'arrow', x1: 0, y1: 0, x2: 200, y2: 0, width: 10, arrowStyle: 'emphasis' }
  assert.notEqual(arrowGeometry(a).path, arrowGeometry({ ...a, arrowStyle: 'standard' }).path)
  assert.equal(pointInArrow(a, 163, 15), true)
  assert.equal(pointInArrow(a, 200, 20), false)
  assert.equal(legacyArrowHead({ ...a, width: 4 }), '200,0 187.2,6.8 187.2,-6.8')
})

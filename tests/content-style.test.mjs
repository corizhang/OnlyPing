import test from 'node:test'
import assert from 'node:assert/strict'
import { annotationTextAppearance, calloutLayout, textLayout } from '../src/lib/tools/text-layout.ts'
import { numberLayout } from '../src/lib/tools/number-layout.ts'
import { restoreToolStyles, normalizeToolStyle } from '../src/lib/tool-style-preferences.ts'
test('legacy text and callout defaults stay compatible; modern defaults are explicit', () => {
  assert.equal(annotationTextAppearance().weight, 700); assert.equal(annotationTextAppearance().outline, true)
  assert.equal(annotationTextAppearance(undefined, true).align, 'center')
  const styles = restoreToolStyles(null)
  assert.equal(styles.text.text.outline, false); assert.equal(styles.callout.textSize, 18)
  assert.equal(styles.highlight.color, '#facc15'); assert.equal(styles.highlight.highlightOpacity, .28)
  assert.notEqual(styles.text, styles['text-box']); assert.notEqual(styles.box.shape, styles.ellipse.shape)
})
test('per-tool settings survive round trips without colors, fonts or shapes leaking to neighbors', () => {
  const styles = restoreToolStyles(null, { color: '#ef4444', textSize: 30, numberR: 24 })
  styles.arrow = normalizeToolStyle({ ...styles.arrow, color: '#2563eb', arrowStyle: 'emphasis' }, 'arrow')
  styles.text = normalizeToolStyle({ ...styles.text, text: { weight: 400, lineHeight: 2 } }, 'text')
  const restored = restoreToolStyles(JSON.parse(JSON.stringify(styles)))
  assert.equal(restored.arrow.color, '#2563eb'); assert.equal(restored.highlight.color, '#facc15')
  assert.equal(restored.text.text.weight, 400); assert.equal(restored['text-box'].text.weight, 600)
  assert.equal(restored.text.text.lineHeight, 2); assert.equal(restored.callout.textSize, 18)
  assert.equal(restored.number.numberR, 24)
})
test('corrupt preferences are bounded and never become invalid annotation properties', () => {
  const style = normalizeToolStyle({ textSize: Infinity, highlightOpacity: 100, text: { weight: 900, lineHeight: -1, padding: 999, backgroundOpacity: NaN }, numberBadge: 'unknown' }, 'text')
  assert.equal(style.textSize, 26); assert.equal(style.text.weight, 600); assert.equal(style.text.lineHeight, 1)
  assert.equal(style.text.padding, 40); assert.equal(style.text.backgroundOpacity, 1); assert.equal(style.numberBadge, 'circle')
})
test('shared text layout uses weight, alignment, padding and line spacing without losing content', () => {
  const a = { x: 100, y: 100, text: '标题\n第二行', size: 24, background: true, textStyle: { weight: 400, align: 'right', lineHeight: 2, padding: 12 } }
  const layout = textLayout(a)
  assert.equal(layout.lineHeight, 48); assert.equal(layout.textX, a.x + layout.textWidth)
  assert.equal(layout.block.x, 88); assert.equal(layout.block.h, 120); assert.ok(layout.top < a.y)
  const bubble = calloutLayout({ text: '中文abcdef'.repeat(12), w: 120, h: 40, size: 24, textStyle: { padding: 15, lineHeight: 2 } }, text => text.length * 12)
  assert.equal(bubble.lines.join(''), '中文abcdef'.repeat(12)); assert.equal(bubble.lineHeight, 48)
  assert.ok(bubble.h >= bubble.lines.length * 48 + 30)
})
test('number badges adapt three-digit labels and preserve legacy circle defaults', () => {
  const a = { id: 'n', kind: 'number', x: 30, y: 30, r: 20 }
  assert.equal(numberLayout(a, 1).fill, '#ef4444')
  const many = numberLayout(a, 123)
  assert.ok(many.fontSize < 20); assert.ok(many.fontSize > 0)
  assert.equal(numberLayout({ ...a, badge: 'ring', color: '#2563eb' }, 1).fill, 'none')
  assert.equal(numberLayout({ ...a, badge: 'ring', color: '#2563eb' }, 1).text, '#2563eb')
  assert.notEqual(numberLayout({ ...a, badge: 'square' }, 1).path, many.path)
})

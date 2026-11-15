import test from 'node:test'
import assert from 'node:assert/strict'
import { calloutLayout, textLayout } from '../src/lib/tools/text-layout.ts'
import { EditHistory } from '../src/lib/history.ts'

test('long callouts preserve every character instead of clipping to the old height', () => {
  const text = '操作说明1234567890'.repeat(20)
  const layout = calloutLayout({ text, w: 100, h: 40 }, s => Array.from(s).length * 10)
  assert.equal(layout.lines.join(''), text)
  assert.ok(layout.lines.every(line => Array.from(line).length <= 8))
  assert.ok(layout.h > 40)
})

test('callouts preserve intentional blank lines and Unicode characters', () => {
  const layout = calloutLayout({ text: '第一行\n\n😀结束', w: 200, h: 20 }, s => Array.from(s).length * 16)
  assert.deepEqual(layout.lines, ['第一行', '', '😀结束'])
  assert.equal(layout.h, 80)
})

test('callouts use measured widths for mixed narrow and wide glyphs', () => {
  const measure = s => Array.from(s).reduce((n, char) => n + (char === 'i' ? 4 : 16), 0)
  const layout = calloutLayout({ text: 'iiii中文iiii', w: 60, h: 20 }, measure)
  assert.equal(layout.lines.join(''), 'iiii中文iiii')
  assert.ok(layout.lines.every(line => measure(line) <= 40))
})

test('text selection bounds contain the first baseline and every explicit line', () => {
  for (const background of [false, true]) {
    const layout = textLayout({ x: 100, y: 100, text: '标题\n说明\n尾行', size: 26, background })
    assert.ok(layout.y < 100)
    assert.ok(layout.y + layout.h > 100 + 2 * layout.lineHeight)
    assert.ok(layout.w >= layout.textWidth)
  }
})

test('one drag is one undo and a new edit invalidates redo', () => {
  const history = new EditHistory()
  history.record(0, 'drag')
  history.record(1, 'drag')
  history.record(2, 'drag')
  assert.equal(history.undo(3), 0)
  assert.equal(history.redo(0), 3)
  assert.equal(history.undo(3), 0)
  history.record(0)
  assert.equal(history.canRedo, false)
})

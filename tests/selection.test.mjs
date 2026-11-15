import test from 'node:test'
import assert from 'node:assert/strict'
import { toggleSelection, editableSelection, moveSelection, copySelection, matchesStep } from '../src/lib/selection.ts'
import { runConsistencyChecks } from '../src/lib/check.ts'

const annotations = [
  { id: 'a', kind: 'box', x: 10, y: 20, w: 50, h: 40 },
  { id: 'b', kind: 'text', x: 100, y: 200, text: '说明', locked: true },
  { id: 'c', kind: 'number', x: 200, y: 250, hidden: true },
  { id: 'd', kind: 'line', x1: 40, y1: 80, x2: 60, y2: 120 },
]

test('shift selection toggles objects without duplicates', () => {
  assert.deepEqual(toggleSelection(['a'], 'b', true), ['a', 'b'])
  assert.deepEqual(toggleSelection(['a', 'b'], 'b', true), ['a'])
  assert.deepEqual(toggleSelection(['a', 'b'], 'd', false), ['d'])
})

test('group moves retain relative geometry and never modify locked or hidden objects', () => {
  const ids = annotations.map(a => a.id)
  const moved = moveSelection(annotations, ids, 25, -10)
  assert.deepEqual(moved[0], { ...annotations[0], x: 35, y: 10 })
  assert.equal(moved[1], annotations[1])
  assert.equal(moved[2], annotations[2])
  assert.deepEqual(moved[3], { ...annotations[3], x1: 65, y1: 70, x2: 85, y2: 110 })
  assert.equal(annotations[0].x, 10)
})

test('batch copy and edit scope exclude protected objects', () => {
  const ids = annotations.map(a => a.id)
  assert.deepEqual(editableSelection(annotations, ids).map(a => a.id), ['a', 'd'])
  let next = 0
  const copies = copySelection(annotations, ids, () => `copy-${++next}`)
  assert.deepEqual(copies.map(a => a.id), ['copy-1', 'copy-2'])
  assert.equal(copies[0].x, 26)
  assert.equal(copies[1].x1, 56)
})

test('step search combines names, notes and completion filters', () => {
  const page = { name: 'Login 登录', notes: '输入验证码', annotations: [] }
  assert.ok(matchesStep(page, ' LOGIN ', 'all'))
  assert.ok(matchesStep(page, '验证码', 'unannotated'))
  assert.ok(!matchesStep(page, '', 'missing-notes'))
  assert.ok(matchesStep({ ...page, notes: '  ' }, '', 'missing-notes'))
  assert.ok(matchesStep({ ...page, annotations: [{ hidden: true }] }, '', 'unannotated'))
  assert.ok(!matchesStep({ ...page, annotations: [{}] }, '', 'unannotated'))
})

test('export checks flag hidden privacy masks rather than considering the page protected', () => {
  const page = { id: 'p', name: '截图', notes: '操作说明', width: 100, height: 100, annotations: [{ id: 'm', kind: 'mosaic', hidden: true, x: 0, y: 0, w: 20, h: 20 }] }
  const issues = runConsistencyChecks('标题', [page], { org: '单位', version: '', showDate: false })
  assert.ok(issues.some(issue => issue.category === '隐私' && issue.severity === 'warn'))
})

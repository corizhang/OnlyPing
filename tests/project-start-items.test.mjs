import test from 'node:test'
import assert from 'node:assert/strict'
import { projectStartItems, recoveryCandidates, recoveryLookupIds } from '../src/lib/project-start-items.ts'
const file = id => ({ id, title: `文件${id}`, pages: 3, accessedAt: 10, path: `${id}.json` })
const draft = (id, savedAt) => ({ key: `project:${id}`, title: `草稿${id}`, savedAt, pages: 4 })
test('file and recovery share a single card; draft-only projects remain visible', () => {
  const items = projectStartItems([file('a')], [draft('a', 30), draft('b', 20), { ...draft('c', 100), revision: 0 }])
  assert.deepEqual(items.map(item => item.id), ['a', 'b']); assert.ok(items[0].file); assert.ok(items[0].recovery)
  assert.equal(items[1].file, undefined); assert.equal(items[1].title, '草稿b')
})
test('limit applies after deduplication and uses last activity with deterministic ties', () => {
  const drafts = Array.from({ length: 20 }, (_, i) => draft(String(i), i))
  const items = projectStartItems([file('19')], drafts)
  assert.equal(items.length, 12); assert.equal(items[0].id, '19'); assert.equal(items.filter(item => item.id === '19').length, 1)
  assert.equal(recoveryCandidates(drafts).length, 12)
})

test('search and hiding happen before the limit, with old pinned drafts first', () => {
  const drafts = Array.from({ length: 30 }, (_, i) => draft(String(i), i))
  const preferences = { pinned: ['0'], hidden: ['29', '28'] }
  const items = projectStartItems([], drafts, preferences)
  assert.equal(items[0].id, '0'); assert.equal(items[0].pinned, true)
  assert.equal(items.length, 12); assert.equal(items[1].id, '27')
  assert.deepEqual(projectStartItems([], drafts, preferences, '草稿1').map(item => item.id), ['19', '18', '17', '16', '15', '14', '13', '12', '11', '10', '1'])
  assert.equal(projectStartItems([], drafts, preferences, '草稿29').length, 0)
  assert.equal(recoveryLookupIds(drafts).length, 30)
  assert.deepEqual(recoveryLookupIds(drafts, '草稿0'), ['0'])
})

test('search matches literal Unicode titles, recovery names and normalized paths', () => {
  const files = [{ ...file('a'), title: '说明_100% ÄBC', path: 'D:\\Projects\\DEMO.json' }]
  const drafts = [draft('a', 30)]
  for (const query of ['äbc', '100%', '_', 'd:/projects/demo', '草稿a']) assert.equal(projectStartItems(files, drafts, undefined, query).length, 1, query)
  assert.equal(projectStartItems(files, drafts, undefined, 'missing').length, 0)
  assert.equal(projectStartItems(files, drafts, { pinned: ['a'], hidden: ['a'] }).length, 0)
})

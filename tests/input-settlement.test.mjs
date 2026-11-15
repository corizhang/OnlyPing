import test from 'node:test'
import assert from 'node:assert/strict'
import { InputSettlement, isComposingKey } from '../src/lib/input-settlement.ts'

test('composition keys include native flags and legacy 229 but ordinary shortcuts remain usable', () => {
  assert.equal(isComposingKey({ isComposing: true }), true)
  assert.equal(isComposingKey({ keyCode: 229 }), true)
  assert.equal(isComposingKey({ isComposing: false, keyCode: 13 }), false)
})

test('a switch waits for composition-end updates, flushes the old owner, then changes the document', async () => {
  const events = [], pending = []
  const gate = new InputSettlement(value => pending.push(value))
  gate.register(() => events.push('flush-old'))
  gate.begin()
  const switchPage = gate.transition(() => events.push('switch'), () => {
    gate.end()
    setTimeout(() => events.push('ime-final-text'), 20)
  }, () => assert.fail('unexpected block'))
  assert.deepEqual(events, [])
  await switchPage
  assert.deepEqual(events, ['ime-final-text', 'flush-old', 'switch'])
  assert.deepEqual(pending, [true, false])
})

test('rapid switches keep only the latest intent and project changes invalidate queued switches', async () => {
  const gate = new InputSettlement(), events = []
  gate.begin()
  const first = gate.transition(() => events.push('a'), () => {}, () => {})
  const last = gate.transition(() => events.push('b'), () => {}, () => {})
  gate.end()
  await Promise.all([first, last])
  assert.deepEqual(events, ['b'])
  gate.begin()
  const stale = gate.transition(() => events.push('old-project'), () => {}, () => {})
  gate.invalidate(); gate.end(); await stale
  assert.deepEqual(events, ['b'])
})

test('normal edits flush immediately, disposal cancels pending work, and StrictMode activation can re-register', async () => {
  const gate = new InputSettlement(), events = []
  const unregister = gate.register(() => events.push('flush'))
  await gate.settle(() => events.push('blur'))
  assert.deepEqual(events, ['blur', 'flush'])
  unregister(); gate.begin()
  const waiting = gate.settle()
  gate.dispose(); assert.equal(await waiting, false)
  gate.activate(); gate.register(() => events.push('new-editor'))
  assert.equal(await gate.settle(), true)
  assert.deepEqual(events, ['blur', 'flush', 'new-editor'])
})

test('missing composition-end blocks a switch without clearing the pending draft', async () => {
  const gate = new InputSettlement(), events = []
  gate.begin()
  await gate.transition(() => events.push('switch'), () => {}, () => events.push('blocked'))
  assert.deepEqual(events, ['blocked'])
  assert.equal(gate.awaitingComposition, true)
  gate.end()
  await gate.transition(() => events.push('retry-switch'), () => {}, () => assert.fail('retry blocked'))
  assert.deepEqual(events, ['blocked', 'retry-switch'], 'ending composition allows an explicit retry without reviving the old action')
  gate.dispose()
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAIAnnotations, parseAIMosaics, parseAINumbers, parseAIPrivacy, parseAIContent } from '../src/lib/ai-response.ts'

test('AI coordinates are finite numbers and every required output has the right structure', () => {
  for (const raw of ['{}', '{"points":{}}', '{"points":[{"x":"0.5","y":0.2}]}', '{"points":[{"x":null,"y":0.2}]}', '{"points":[{"x":1e999,"y":0.2}]}']) {
    assert.throws(() => parseAINumbers(raw), /AI 返回数据不符合要求/)
  }
  assert.throws(() => parseAIAnnotations('{"boxes":[]}'), /不符合要求/)
  assert.throws(() => parseAIPrivacy('{"issues":[{"region":null}]}'), /不符合要求/)
})

test('AI regions are clipped to the image and empty intersections are discarded', () => {
  const regions = parseAIMosaics(JSON.stringify({ regions: [
    { x: .9, y: .8, w: .5, h: .7 },
    { x: -.1, y: -.2, w: .3, h: .5 },
    { x: 2, y: 2, w: 1, h: 1 },
  ] }))
  assert.equal(regions.length, 2)
  for (const r of regions) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0)
    assert.ok(r.x + r.w <= 1 && r.y + r.h <= 1)
  }
  assert.throws(() => parseAIMosaics('{"regions":[{"x":0,"y":0,"w":-1,"h":1}]}'), /不符合要求/)
})

test('AI JSON accepts fenced responses, rejects invalid and oversized payloads', () => {
  assert.deepEqual(parseAINumbers('```json\n{"points":[{"x":-1,"y":2}]}\n```'), [{ x: 0, y: 1 }])
  assert.throws(() => parseAINumbers('not json'), /有效 JSON/)
  assert.throws(() => parseAINumbers('{broken}'), /格式错误/)
  assert.throws(() => parseAINumbers('x'.repeat(256_001)), /过长/)
  assert.throws(() => parseAINumbers(JSON.stringify({ points: Array.from({ length: 201 }, () => ({ x: .5, y: .5 })) })), /不符合要求/)
  assert.equal(parseAINumbers(JSON.stringify({ points: Array.from({ length: 30 }, () => ({ x: .5, y: .5 })) })).length, 12)
})

test('API message envelopes require bounded nonempty text rather than arbitrary objects', () => {
  assert.equal(parseAIContent({ choices: [{ message: { content: '  内容  ' } }] }), '内容')
  for (const payload of [{}, { choices: [] }, { choices: [{ message: { content: {} } }] }, { choices: [{ message: { content: ' ' } }] }]) {
    assert.throws(() => parseAIContent(payload), /接口响应格式错误/)
  }
})

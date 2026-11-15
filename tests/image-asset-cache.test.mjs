import test from 'node:test'
import assert from 'node:assert/strict'
import { ImageAssetCache } from '../src/lib/image-asset-cache.ts'

test('weak owners reuse image hashes even after the bounded content cache evicts them', async () => {
  const cache = new ImageAssetCache(), owners = Array.from({ length: 40 }, () => ({}))
  const original = crypto.subtle.digest.bind(crypto.subtle)
  let calls = 0
  crypto.subtle.digest = (...args) => { calls++; return original(...args) }
  try {
    const keys = []
    for (let i = 0; i < owners.length; i++) keys.push(await cache.key(`image-${i}`, owners[i]))
    assert.equal(calls, 40)
    for (let i = 0; i < owners.length; i++) assert.equal(await cache.key(`image-${i}`, owners[i]), keys[i])
    assert.equal(calls, 40, 'unchanged owners must not rehash evicted content')
    assert.equal(await cache.key('image-39', {}), keys[39])
    assert.equal(calls, 40, 'new owners can share recently hashed content')
    assert.notEqual(await cache.key('changed-image', owners[0]), keys[0], 'mutated owners cannot reuse the wrong hash')
    assert.equal(calls, 41)
  } finally { crypto.subtle.digest = original }
})

test('large images use weak owner reuse without entering the strong content cache', async () => {
  const cache = new ImageAssetCache(), owner = {}, image = 'x'.repeat(2_000_001)
  const original = crypto.subtle.digest.bind(crypto.subtle)
  let calls = 0
  crypto.subtle.digest = (...args) => { calls++; return original(...args) }
  try {
    const key = await cache.key(image, owner)
    assert.equal(await cache.key(image, owner), key)
    assert.equal(calls, 1)
    assert.equal(await cache.key(image, {}), key)
    assert.equal(calls, 2, 'large strings must not accumulate in the strong cache')
  } finally { crypto.subtle.digest = original }
})

// Isolated operation benchmark, not browser latency or memory measurement.
import 'fake-indexeddb/auto'
import { IDBObjectStore } from 'fake-indexeddb'
import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@/types') return { url: new URL('../src/types/index.ts', import.meta.url).href, shortCircuit: true }
  return next(specifier, context)
} })
const { idbSet } = await import('../src/lib/db.ts')
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'))
let data = { ...input, projectId: 'isolated-storage-benchmark' }
const count = { hashes: 0, hashedBytes: 0, imageWrites: 0, imageValueCursors: 0, imageKeyCursors: 0 }
const digest = crypto.subtle.digest.bind(crypto.subtle)
crypto.subtle.digest = (...args) => { count.hashes++; count.hashedBytes += args[1].byteLength; return digest(...args) }
for (const [method, counter] of [['put', 'imageWrites'], ['openCursor', 'imageValueCursors'], ['openKeyCursor', 'imageKeyCursors']]) {
  const original = IDBObjectStore.prototype[method]
  IDBObjectStore.prototype[method] = function (...args) { if (this.name === 'images') count[counter]++; return original.apply(this, args) }
}
async function measure(label) {
  const before = { ...count }, start = performance.now()
  await idbSet({ ...data, savedAt: Date.now() })
  console.log(JSON.stringify({ label, milliseconds: Math.round(performance.now() - start), ...Object.fromEntries(Object.entries(count).map(([k, n]) => [k, n - before[k]])) }))
}
await measure('initial')
for (let i = 1; i <= 3; i++) {
  data = { ...data, pages: data.pages.map((p, index) => index ? p : { ...p, name: `Edit ${i}` }) }
  await measure(`edit-${i}`)
}

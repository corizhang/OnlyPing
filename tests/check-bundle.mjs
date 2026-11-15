import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import assert from 'node:assert/strict'

// Run after build. Follow static imports, rather than measuring only entry.js.
const dist = new URL('../dist/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', dist), 'utf8'))
const startup = new Set()
function visit(key) {
  if (startup.has(key)) return
  assert.ok(manifest[key], `Missing manifest chunk: ${key}`)
  startup.add(key)
  for (const dependency of manifest[key].imports ?? []) visit(dependency)
}
visit('index.html')
let bytes = 0, gzip = 0
for (const key of startup) {
  const buffer = readFileSync(new URL(manifest[key].file, dist))
  bytes += buffer.length
  gzip += gzipSync(buffer).length
}
for (const name of ['export-word', 'export-document', 'export-layout', 'jspdf.es.min', 'jszip.min', 'AIPanel', 'ai']) {
  const chunk = Object.entries(manifest).find(([, item]) => item.name === name)
  assert.ok(chunk, `Expected deferred engine missing: ${name}`)
  assert.ok(!startup.has(chunk[0]), `Heavy engine loaded at startup: ${name}`)
}
assert.ok(bytes <= 1_250_000, `Startup JS exceeds 1.25 MB: ${bytes} bytes`)
assert.ok(gzip <= 400_000, `Startup gzip JS exceeds 400 KB: ${gzip} bytes`)
console.log(`PASS: startup JavaScript ${bytes} bytes, gzip ${gzip} bytes; export/AI engines deferred`)

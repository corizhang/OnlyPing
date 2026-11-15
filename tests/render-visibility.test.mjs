import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Node 不原生加载 TSX；测试加载器只转换本地源码，不修改生产打包入口。
registerHooks({
  resolve(specifier, context, next) {
    let candidate
    if (specifier === '@/types') candidate = new URL('../src/types/index.ts', import.meta.url)
    else if (specifier.startsWith('@/')) candidate = new URL('../src/' + specifier.slice(2), import.meta.url)
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = new URL(specifier, context.parentURL)
    if (candidate) {
      for (const suffix of ['', '.ts', '.tsx']) {
        const url = new URL(candidate.href + suffix)
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
      }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('.tsx')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText }
    return next(url, context)
  },
})

const draws = []
globalThis.Image = class {
  set src(value) { this.value = value; queueMicrotask(() => this.onload()) }
}
globalThis.document = { createElement: () => {
  const ctx = new Proxy({
    measureText: text => ({ width: text.length * 10 }),
    fillRect: (...args) => draws.push(args),
  }, { get: (target, key) => key in target ? target[key] : () => {} })
  return { width: 100, height: 100, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,dGVzdA==' }
} }
const { renderPageToCanvas, preparePageForAI, loadImage, clearImageCache } = await import('../src/lib/render.ts')
const { computeNumberStarts } = await import('../src/types/index.ts')
const page = { id: 'page', name: '测试', notes: '', width: 100, height: 100, image: 'data:image/png;base64,eA==', annotations: [
  { id: 'visible', kind: 'redact', x: 1, y: 2, w: 10, h: 10, color: '#000000', locked: true },
  { id: 'hidden', kind: 'redact', x: 30, y: 40, w: 20, h: 20, color: '#000000', hidden: true },
] }

test('exports omit hidden objects and still render locked objects', async () => {
  draws.length = 0
  await renderPageToCanvas(page)
  assert.deepEqual(draws, [[1, 2, 10, 10]])
})

test('AI image preparation retains privacy masks even when hidden in the editor', async () => {
  for (const privacy of [false, true]) {
    draws.length = 0
    await preparePageForAI(page, privacy)
    assert.ok(draws.some(args => args[0] === 30 && args[1] === 40))
  }
})

test('hidden numbers do not create gaps in cross-page numbering', () => {
  const pages = [
    { id: 'a', annotations: [{ kind: 'number' }, { kind: 'number', hidden: true }] },
    { id: 'b', annotations: [{ kind: 'number', locked: true }] },
    { id: 'c', annotations: [] },
  ]
  assert.deepEqual([...computeNumberStarts(pages)], [['a', 0], ['b', 1], ['c', 2]])
})

test('decoded image cache evicts by pixel budget and retains recently used images', async () => {
  const OriginalImage = globalThis.Image
  let created = 0
  clearImageCache()
  globalThis.Image = class {
    naturalWidth = 4000; naturalHeight = 4000
    constructor() { created++ }
    set src(_value) { queueMicrotask(() => this.onload()) }
  }
  try {
    await loadImage('cache-a'); await loadImage('cache-b'); await loadImage('cache-c')
    await loadImage('cache-b')
    assert.equal(created, 3)
    await loadImage('cache-a')
    assert.equal(created, 4)
  } finally { clearImageCache(); globalThis.Image = OriginalImage }
})

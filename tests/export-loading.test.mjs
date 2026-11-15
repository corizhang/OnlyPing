import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { exportDocx, exportPdf, exportLongImage, renderDocument } from '../src/lib/exporters.ts'
import { isTaskCancelled } from '../src/lib/render-task.ts'

test('pre-cancelled exports reject before loading any browser-only engine', async () => {
  const controller = new AbortController(); controller.abort()
  const task = { signal: controller.signal }
  for (const run of [exportDocx, exportPdf, exportLongImage]) {
    await assert.rejects(run('x', [], undefined, undefined, 1, task), isTaskCancelled)
  }
  await assert.rejects(renderDocument('x', [], {}, {}, 'pdf', 1, task), isTaskCancelled)
})

test('cancellation during module loading prevents the newly loaded engine from running', async () => {
  const controller = new AbortController()
  globalThis.exportLoadingController = controller
  globalThis.exportEngineCalls = 0
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === './export-word' && context.parentURL?.endsWith('/exporters.ts')) {
      const source = 'globalThis.exportLoadingController.abort(); export function exportDocx() { globalThis.exportEngineCalls++ }'
      return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true }
    }
    return next(specifier, context)
  } })
  try {
    await assert.rejects(exportDocx('x', [], undefined, undefined, 1, { signal: controller.signal }), isTaskCancelled)
    assert.equal(globalThis.exportEngineCalls, 0)
  } finally {
    hooks.deregister()
    delete globalThis.exportLoadingController
    delete globalThis.exportEngineCalls
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createImageExportQAServer } from './serve-image-export-qa.mjs'
test('QA artifact collector accepts only named local-origin files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'onlyping-image-qa-'))
  const server = await createImageExportQAServer(directory)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const send = (path, origin = 'http://127.0.0.1:3011') => fetch(`${base}${path}`, { method: 'POST', headers: { Origin: origin }, body: 'synthetic' })
    assert.equal((await send('/artifact/report.json')).status, 200)
    assert.equal(await readFile(join(directory, 'report.json'), 'utf8'), 'synthetic')
    assert.equal((await send('/artifact/all.zip', 'https://example.invalid')).status, 403)
    assert.equal((await send('/artifact/unknown.json')).status, 404)
    assert.equal((await send('/artifact/%2e%2e%2foutside.json')).status, 404)
    assert.deepEqual(await readdir(directory), ['report.json'])
  } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }) }
})

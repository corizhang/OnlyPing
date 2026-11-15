import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { productionQAServer } from './serve-production.mjs'

test('production QA serves HTML fresh, hashed assets immutable, missing scripts as 404 and faults recoverably', async () => {
  const root = await mkdtemp(join(tmpdir(), 'onlyping-host-qa-'))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<title>QA app</title>')
  await writeFile(join(root, 'assets/AIPanel-test.js'), 'export default 42')
  const qa = productionQAServer({ root })
  try {
    await new Promise(resolve => qa.server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${qa.server.address().port}`
    let response = await fetch(origin)
    assert.equal(response.headers.get('cache-control'), 'no-cache')
    assert.match(await response.text(), /QA app/)
    response = await fetch(`${origin}/assets/AIPanel-test.js`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /javascript/)
    assert.match(response.headers.get('cache-control'), /immutable/)
    response = await fetch(`${origin}/assets/deleted-version.js`)
    assert.equal(response.status, 404)
    assert.ok(!(await response.text()).includes('QA app'), 'missing scripts must not fall back to index.html')
    response = await fetch(`${origin}/editor`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-cache')
    qa.setFailure('AIPanel')
    response = await fetch(`${origin}/assets/AIPanel-test.js`)
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    qa.setFailure('')
    response = await fetch(`${origin}/assets/AIPanel-test.js`)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'export default 42')
    response = await fetch(`${origin}/%2e%2e%2foutside.txt`)
    assert.equal(response.status, 403)
  } finally {
    if (qa.server.listening) await new Promise(resolve => qa.server.close(resolve))
    await unlink(join(root, 'index.html')); await unlink(join(root, 'assets/AIPanel-test.js'))
    await rmdir(join(root, 'assets')); await rmdir(root)
  }
})

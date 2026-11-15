import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('desktop and frontend release metadata agree and the embedded app uses the real build output', () => {
  const pkg = JSON.parse(read('package.json'))
  const config = JSON.parse(read('src-tauri/tauri.conf.json'))
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))[1]
  assert.equal(config.version, pkg.version)
  assert.equal(cargoVersion, pkg.version)
  assert.equal(config.build.frontendDist, '../dist')
  assert.ok(config.app.windows.every(window => window.dragDropEnabled === false), 'native drop interception must not disable the existing HTML step sorting')
})

test('desktop filesystem commands are limited to the local main window with no global path grants', () => {
  const capability = JSON.parse(read('src-tauri/capabilities/default.json'))
  assert.deepEqual(capability.windows, ['main'])
  assert.ok(!capability.remote)
  assert.ok(capability.permissions.includes('allow-read-ai-key'))
  assert.ok(capability.permissions.includes('allow-write-ai-key'))
  assert.deepEqual(capability.permissions.filter(p => typeof p === 'string' && p.startsWith('fs:')).sort(), ['fs:allow-read-file', 'fs:allow-write-file'])
  assert.ok(!capability.permissions.some(p => typeof p === 'object' && (p.allow || p.identifier?.startsWith('fs:'))), 'user-picked paths, not a blanket filesystem scope')
})

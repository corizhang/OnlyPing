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
  assert.ok(capability.permissions.includes('allow-project-file-version'))
  assert.ok(capability.permissions.includes('allow-project-file-write'))
  for (const command of ['info', 'check', 'download', 'cancel', 'install']) assert.ok(capability.permissions.includes(`allow-app-update-${command}`))
  assert.ok(!capability.permissions.some(p => typeof p === 'string' && p.startsWith('updater:')), 'only app-owned updater commands are exposed')
  for (const command of ['preferences', 'save-preferences', 'close-action']) assert.ok(capability.permissions.includes(`allow-desktop-${command}`))
  assert.ok(!capability.permissions.includes('core:window:allow-destroy'), 'exit uses the guarded lifecycle instead of directly destroying the window')
  for (const command of ['info', 'directory', 'save', 'remember', 'lookup', 'open', 'snapshot', 'library-update', 'relocate']) assert.ok(capability.permissions.includes(`allow-workspace-${command}`))
  for (const command of ['begin', 'write', 'end', 'file-location', 'open-location']) assert.ok(capability.permissions.includes(`allow-image-export-${command}`))
  for (const command of ['ready', 'migrate', 'save', 'read', 'delete', 'missing-assets', 'list', 'location', 'open-directory']) {
    assert.ok(capability.permissions.includes(`allow-project-storage-${command}`))
  }
  assert.deepEqual(capability.permissions.filter(p => typeof p === 'string' && p.startsWith('fs:')).sort(), ['fs:allow-read-file', 'fs:allow-write-file'])
  assert.ok(!capability.permissions.some(p => typeof p === 'object' && (p.allow || p.identifier?.startsWith('fs:'))), 'user-picked paths, not a blanket filesystem scope')
})

test('QA application uses a separate identity and a visible test title', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'))
  const qa = JSON.parse(read('src-tauri/tauri.qa.conf.json'))
  assert.notEqual(qa.identifier, config.identifier)
  assert.ok(qa.identifier.endsWith('.qa'))
  assert.ok(qa.app.windows.every(window => window.title.includes('QA')))
})

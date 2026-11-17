import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultImageExportPreferences, readImageExportPreferences, saveImageExportPreferences } from '../src/lib/image-export-preferences.ts'
const options = { size: { mode: 'percent', value: 50 }, numbering: 'per-image', format: 'jpeg', quality: 85, destination: 'folder' }
function memory() { let raw = null; return { getItem: () => raw, setItem: (key, value) => { raw = value } } }
test('preferences roundtrip contains only export settings and no path or selected images', () => {
  const storage = memory()
  assert.equal(saveImageExportPreferences({ ...options, directory: 'D:/private', ids: ['private-image'], unknown: true }, storage), true)
  assert.deepEqual(readImageExportPreferences(true, storage), options)
  assert.ok(!storage.getItem().includes('private'))
  assert.deepEqual(readImageExportPreferences(false, storage), { ...options, destination: 'download' })
  assert.deepEqual(readImageExportPreferences(true, storage), options, 'web fallback does not silently overwrite desktop settings')
})
test('malformed, future and invalid records reset safely', () => {
  for (const raw of ['{', 'x'.repeat(2049), 'null', JSON.stringify({ version: 2, options }), JSON.stringify({ version: 1, options: { ...options, quality: 0 } }), JSON.stringify({ version: 1, options: { ...options, size: { mode: 'maxWidth', value: 0 } } })]) {
    assert.deepEqual(readImageExportPreferences(true, { getItem: () => raw }), defaultImageExportPreferences())
  }
  const first = defaultImageExportPreferences(); first.size.mode = 'changed'
  assert.equal(defaultImageExportPreferences().size.mode, 'original')
})
test('blocked storage never prevents opening or exporting', () => {
  const storage = { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('quota') } }
  assert.deepEqual(readImageExportPreferences(true, storage), defaultImageExportPreferences())
  assert.equal(saveImageExportPreferences(options, storage), false)
  assert.equal(saveImageExportPreferences({ ...options, quality: 101 }, memory()), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readRecoverableProject } from '../src/lib/project-recovery.ts'

const validate = value => value?.valid ? value : null
test('read errors still try the independent backup', async () => {
  const backup = { valid: true, title: '恢复副本' }
  assert.equal(await readRecoverableProject(async key => { if (key === 'autosave') throw Error('missing image'); return backup }, validate), backup)
})
test('unavailable store never becomes a new empty project', async () => {
  await assert.rejects(readRecoverableProject(async () => { throw Error('disk failure') }, validate), /disk failure/)
})
test('invalid backup alone is still retained rather than overwritten as empty', async () => {
  await assert.rejects(readRecoverableProject(async key => key === 'backup' ? { broken: true } : null, validate), /暂停自动保存/)
})
test('truly empty storage permits creation and a valid primary skips backup', async () => {
  assert.equal(await readRecoverableProject(async () => null, validate), null)
  let reads = 0
  await readRecoverableProject(async () => { reads++; return { valid: true } }, validate)
  assert.equal(reads, 1)
})

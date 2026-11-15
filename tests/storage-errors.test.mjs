import test from 'node:test'
import assert from 'node:assert/strict'
import { storageErrorMessage } from '../src/lib/storage-errors.ts'

test('quota errors give backup and cleanup instructions while preserving conflict detail', () => {
  const message = storageErrorMessage(new DOMException('Full', 'QuotaExceededError'))
  assert.match(message, /空间不足/)
  assert.match(message, /备份/)
  assert.match(message, /不要清除网站数据/)
  assert.equal(storageErrorMessage(new Error('项目冲突')), '项目冲突')
  assert.match(storageErrorMessage(null), /本地存储不可用/)
})

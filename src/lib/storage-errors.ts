export function storageErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError') {
    return '浏览器存储空间不足。请先下载当前项目备份，再从本地项目列表删除不需要的项目，然后重试保存。不要清除网站数据。'
  }
  return error instanceof Error ? error.message : '本地存储不可用，请下载项目备份后重试'
}

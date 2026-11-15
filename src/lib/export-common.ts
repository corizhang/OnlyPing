import type { ExportFooter } from '@/types'

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

/** 组装页脚文本：编制单位 + 日期 + 版本 */
export function footerText(footer: ExportFooter): string {
  const parts: string[] = []
  if (footer.org) parts.push(footer.org)
  if (footer.showDate) parts.push(`编制日期：${new Date().toLocaleDateString('zh-CN')}`)
  if (footer.version) parts.push(`版本：${footer.version}`)
  return parts.join('　')
}

import type { ExportFooter, Page, Rect } from '@/types'

export interface CheckIssue {
  severity: 'warn' | 'info'
  /** 关联页面（可定位跳转） */
  pageId?: string
  pageName?: string
  category: string
  message: string
}

/** 提取说明文字中显式引用序号的位置数量（如「1.」「（2）」「①」开头的行） */
function countNumberRefs(notes: string): number {
  const re = /^\s*(?:\d{1,2}[.、．)]|[（(]\d{1,2}[)）]|[①-⑩])/gm
  return (notes.match(re) ?? []).length
}

/** 运行确定性一致性检查（本地完成，不依赖 AI） */
export function runConsistencyChecks(
  title: string,
  pages: Page[],
  exportFooter: ExportFooter
): CheckIssue[] {
  const issues: CheckIssue[] = []

  if (pages.length === 0) {
    issues.push({ severity: 'info', category: '项目', message: '还没有导入任何页面。' })
    return issues
  }

  if (!title.trim()) {
    issues.push({ severity: 'warn', category: '版式', message: '主标题为空，导出的文档将没有标题。' })
  }

  if (!exportFooter.org.trim()) {
    issues.push({
      severity: 'info',
      category: '版式',
      message: '未填写编制单位，导出页脚中将只显示日期与版本。',
    })
  }

  pages.forEach((p, i) => {
    const at = { pageId: p.id, pageName: p.name }
    const step = `第 ${i + 1} 页「${p.name}」`

    if (!p.notes.trim()) {
      issues.push({ severity: 'warn', category: '说明', ...at, message: `${step}缺少说明文字，导出后该步骤没有操作指引。` })
    }

    if (p.annotations.length === 0) {
      issues.push({ severity: 'info', category: '标注', ...at, message: `${step}没有任何标注，确认是否漏标。` })
    }

    const nums = p.annotations.filter((a) => a.kind === 'number').length
    if (nums > 12) {
      issues.push({
        severity: 'info',
        category: '序号',
        ...at,
        message: `${step}有 ${nums} 个序号标注，单步操作过多，建议拆分为两个步骤。`,
      })
    }

    const refs = countNumberRefs(p.notes)
    if (refs > 0 && nums === 0) {
      issues.push({
        severity: 'warn',
        category: '序号',
        ...at,
        message: `${step}的说明引用了 ${refs} 处序号，但图中没有序号标注。`,
      })
    } else if (refs > nums && nums > 0) {
      issues.push({
        severity: 'warn',
        category: '序号',
        ...at,
        message: `${step}的说明引用了 ${refs} 处序号，但本页只有 ${nums} 个序号标注，数量对不上。`,
      })
    } else if (nums > 0 && refs === 0 && p.notes.trim()) {
      issues.push({
        severity: 'info',
        category: '序号',
        ...at,
        message: `${step}有 ${nums} 个序号标注，但说明文字没有引用它们，读者不知道每个序号该做什么。`,
      })
    }
  })

  return issues
}

/** 归一化矩形 r 被 mosaics 覆盖的面积比例（0~1） */
export function rectCoverage(r: Rect, mosaics: Rect[]): number {
  const area = r.w * r.h
  if (area <= 0) return 0
  let covered = 0
  for (const m of mosaics) {
    const x1 = Math.max(r.x, m.x)
    const y1 = Math.max(r.y, m.y)
    const x2 = Math.min(r.x + r.w, m.x + m.w)
    const y2 = Math.min(r.y + r.h, m.y + m.h)
    if (x2 > x1 && y2 > y1) covered += (x2 - x1) * (y2 - y1)
  }
  return Math.min(1, covered / area)
}

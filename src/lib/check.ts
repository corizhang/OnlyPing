import type { ExportFooter, Page, Rect } from '@/types'

export interface CheckIssue {
  severity: 'warn' | 'info'
  /** 关联页面（可定位跳转） */
  pageId?: string
  pageName?: string
  category: string
  message: string
}

/** 统计说明里的序号引用；支持行首步骤号、圈号，以及「点击2处」等行内写法。 */
function countNumberRefs(notes: string): number {
  let count = 0
  const linePrefix = /^\s*(?:\d{1,2}[.、．)]|[（(]\d{1,2}[)）])\s*/
  const inlineRefs = /[①-⑳]|(?:序号|第|点击|按|选择|点按|进入|打开|在)\s*[（(]?\d{1,2}[）)]?\s*(?:处|号|步|个|项|位置)/g

  for (const line of notes.split(/\r?\n/)) {
    const matches = line.match(inlineRefs)
    if (matches?.length) count += matches.length
    else if (linePrefix.test(line)) count += 1
  }
  return count
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
  const width = Math.max(0, r.w)
  const height = Math.max(0, r.h)
  const area = width * height
  if (area <= 0) return 0

  const rx2 = r.x + width
  const ry2 = r.y + height
  const intersections: Rect[] = []
  for (const m of mosaics) {
    const x1 = Math.max(r.x, m.x)
    const y1 = Math.max(r.y, m.y)
    const x2 = Math.min(rx2, m.x + Math.max(0, m.w))
    const y2 = Math.min(ry2, m.y + Math.max(0, m.h))
    if (x2 > x1 && y2 > y1) intersections.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
  }

  // Integrate the union of y intervals across x slices so overlapping mosaics count once.
  const xs = [...new Set(intersections.flatMap((m) => [m.x, m.x + m.w]))].sort((a, b) => a - b)
  let covered = 0
  for (let i = 0; i < xs.length - 1; i++) {
    const x1 = xs[i]
    const x2 = xs[i + 1]
    if (x2 <= x1) continue
    const intervals = intersections
      .filter((m) => m.x < x2 && m.x + m.w > x1)
      .map((m) => [m.y, m.y + m.h] as const)
      .sort((a, b) => a[0] - b[0])
    let coveredY = 0
    let start: number | null = null
    let end = 0
    for (const [y1, y2] of intervals) {
      if (start === null) {
        start = y1
        end = y2
      } else if (y1 <= end) {
        end = Math.max(end, y2)
      } else {
        coveredY += end - start
        start = y1
        end = y2
      }
    }
    if (start !== null) coveredY += end - start
    covered += (x2 - x1) * coveredY
  }
  return Math.min(1, covered / area)
}

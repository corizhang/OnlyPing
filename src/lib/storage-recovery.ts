import type { LegacySnapshot } from './desktop-project-store.ts'
import type { ProjectData } from './db.ts'

/** Read-only extraction: retain damaged records in the raw snapshot, report every failure. */
export function extractLegacyProjects(snapshot: LegacySnapshot, validate: (value: unknown) => ProjectData | null) {
  const assets = new Map(snapshot.assets)
  const projects: { source: string; data: ProjectData }[] = []
  const failures: { source: string; reason: string }[] = []
  const expand = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as ProjectData).pages)) throw Error('项目结构无效')
    const data = raw as ProjectData
    const image = (value: unknown): string => {
      if (typeof value !== 'string') throw Error('图片引用无效')
      if (!value.startsWith('asset:')) return value
      const resolved = assets.get(value)
      if (!resolved) throw Error('图片资源缺失')
      return resolved
    }
    return { ...data, pages: data.pages.map(page => ({ ...page, image: image(page.image), orig: page.orig ? { ...page.orig, image: image(page.orig.image) } : undefined })) }
  }
  for (const [key, value] of snapshot.records) {
    if (key.startsWith('deleted:')) continue
    const values = key.startsWith('history:') && Array.isArray(value) ? value : [value]
    values.forEach((raw, index) => {
      const source = key.startsWith('history:') ? `${key}[${index}]` : key
      try {
        const data = validate(expand(raw))
        if (!data) throw Error('项目校验失败')
        projects.push({ source, data })
      } catch (error) { failures.push({ source, reason: error instanceof Error ? error.message : '无法读取' }) }
    })
  }
  return { projects, failures }
}

export async function makeLegacyRecoveryZip(snapshot: LegacySnapshot, validate: (value: unknown) => ProjectData | null, legacyAutosave?: string | null) {
  const result = extractLegacyProjects(snapshot, validate)
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  if (legacyAutosave) {
    zip.file('legacy-localstorage.txt', legacyAutosave)
    try {
      const data = validate(JSON.parse(legacyAutosave))
      if (!data) throw Error('旧 localStorage 存档校验失败')
      result.projects.push({ source: 'localStorage:mbz-autosave', data })
    } catch { result.failures.push({ source: 'localStorage:mbz-autosave', reason: '无法转换为项目，原始文本保留在 legacy-localstorage.txt' }) }
  }
  zip.file('snapshot.json', JSON.stringify({ kind: 'onlyping-indexeddb-recovery', version: 1, ...snapshot }))
  result.projects.forEach((entry, index) => zip.file(`projects/${String(index + 1).padStart(4, '0')}.json`, JSON.stringify(entry.data)))
  zip.file('report.json', JSON.stringify({ recovered: result.projects.map((entry, index) => ({ source: entry.source, title: entry.data.title, file: `projects/${String(index + 1).padStart(4, '0')}.json` })), failures: result.failures }, null, 2))
  zip.file('README.txt', '这是旧 IndexedDB 的只读恢复包，可能包含迁移前的旧版本。\nprojects 中的 JSON 可在 OnlyPing 打开；历史及别名可能重复。\nsnapshot.json 保留所有原始记录与图片，不能直接当作项目导入。\nreport.json 列出已恢复和失败的条目；缺失的图片不会被伪造。\n本包不读取 AI 配置或密钥，包含项目截图与说明，请妥善保管。')
  return { blob: await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), count: result.projects.length, failed: result.failures.length }
}

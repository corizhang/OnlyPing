import type { ProjectData } from './db.ts'
import type { ProjectFileSource } from './project-files.ts'

/** Validate a picked candidate without registering it or changing the workspace. */
export async function inspectProjectRelocation(source: ProjectFileSource, id: string, validate: (value: unknown) => ProjectData | null): Promise<ProjectData> {
  if (source.file.size > 512 * 1024 * 1024) throw new Error('项目文件超过 512 MiB，未修改原关联')
  let value: unknown
  try { value = JSON.parse((await source.file.text()).replace(/^\uFEFF/, '')) }
  catch { throw new Error('所选文件不是有效的项目 JSON，未修改原关联') }
  const data = validate(value)
  if (!data) throw new Error('所选项目格式无效，未修改原关联')
  if (data.projectId !== id) throw new Error('所选文件不是同一个项目，未修改原关联。如需打开其他项目，请使用“打开项目文件”。')
  return data
}

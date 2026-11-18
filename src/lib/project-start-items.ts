import type { LocalProjectEntry } from './db.ts'
import type { LibraryPreferences, WorkspaceEntry } from './workspace.ts'
export type StartItem = { id: string; title: string; pages: number; updatedAt: number; pinned: boolean; file?: WorkspaceEntry; recovery?: LocalProjectEntry }
const normalize = (value: string) => value.toLowerCase().replaceAll('\\', '/')
const currentRecoveries = (entries: LocalProjectEntry[]) => entries.filter(entry => entry.revision === undefined && entry.key.startsWith('project:')).sort((a, b) => b.savedAt - a.savedAt)
export function recoveryCandidates(entries: LocalProjectEntry[]) { return currentRecoveries(entries).slice(0, 12) }
export function recoveryLookupIds(entries: LocalProjectEntry[], query = '') { return [...new Set(currentRecoveries(entries).filter(entry => normalize(entry.title).includes(normalize(query.trim()))).map(entry => entry.key.slice('project:'.length)).filter(Boolean))].slice(0, 2000) }
export function projectStartItems(files: WorkspaceEntry[], recoveries: LocalProjectEntry[], preferences: LibraryPreferences = { pinned: [], hidden: [] }, query = ''): StartItem[] {
  const items = new Map<string, StartItem>()
  for (const file of files) items.set(file.id, { id: file.id, title: file.title, pages: file.pages, updatedAt: file.accessedAt, pinned: preferences.pinned.includes(file.id), file })
  for (const recovery of currentRecoveries(recoveries)) {
    const id = recovery.key.slice('project:'.length)
    if (!id) continue
    const item = items.get(id)
    if (item) { if (!item.recovery) item.recovery = recovery; item.updatedAt = Math.max(item.updatedAt, recovery.savedAt) }
    else items.set(id, { id, title: recovery.title, pages: recovery.pages, updatedAt: recovery.savedAt, pinned: preferences.pinned.includes(id), recovery })
  }
  const needle = normalize(query.trim())
  return [...items.values()].filter(item => !preferences.hidden.includes(item.id) && [item.title, item.file?.path ?? '', item.recovery?.title ?? ''].some(value => normalize(value).includes(needle))).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).slice(0, 12)
}

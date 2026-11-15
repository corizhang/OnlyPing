import type { ProjectData } from './db'
import { saveFile } from './files'

// In-memory only: keep the last committed React project state through unmount.
// This deliberately excludes keys, preferences and other browser storage.
let recoveryProject: ProjectData | null = null
export function setRecoveryProject(project: ProjectData) { recoveryProject = project }
export function getRecoveryProject() { return recoveryProject }

export async function downloadRecoveryBackup() {
  if (!recoveryProject) return false
  await saveFile(new Blob([JSON.stringify(recoveryProject)], { type: 'application/json' }), 'OnlyPing-故障恢复备份.json')
  return true
}

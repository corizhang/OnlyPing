import type { ProjectData } from './db'

// In-memory only: keep the last committed React project state through unmount.
// This deliberately excludes keys, preferences and other browser storage.
let recoveryProject: ProjectData | null = null
export function setRecoveryProject(project: ProjectData) { recoveryProject = project }
export function getRecoveryProject() { return recoveryProject }

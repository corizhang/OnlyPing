interface Host {
  update: boolean
  busy: boolean
  ready: boolean
  persist(): Promise<boolean>
  file(): Promise<{ dirty: boolean; uncertain: boolean }>
  warn(message: string): void
  confirm?: (message: string, options: { title: string; kind: 'warning'; okLabel: string; cancelLabel: string }) => Promise<boolean>
}
/** Shared input settlement / recovery-save guard for exit and updater installation. */
export async function prepareDesktopLeave(host: Host) {
  if (host.busy) { host.warn('请先完成当前文件操作或 AI 任务，再退出或安装更新'); return false }
  const persisted = host.ready && await host.persist()
  if (host.update && !persisted) { host.warn('本机恢复存档未保存成功，已停止更新，请先备份项目'); return false }
  const file = persisted ? await host.file() : { dirty: true, uncertain: false }
  if (persisted && !file.dirty) return true
  const suffix = host.update ? '仍然安装更新并重启？' : '仍然关闭？'
  const message = persisted ? file.uncertain ? `项目文件已在外部修改或无法读取，当前工作区已保存在本机恢复存档。可返回核对版本或另存为副本。${suffix}` : `当前修改已自动保存到本机，但关联的 JSON 文件尚未更新。可返回按 Ctrl+S 保存文件，或下次从本地项目恢复。${suffix}` : '本地保存未完成。建议留在编辑器下载项目备份，直接关闭可能丢失未保存修改。仍然关闭？'
  const confirm = host.confirm ?? (await import('@tauri-apps/plugin-dialog')).confirm
  return confirm(message, { title: host.update ? 'OnlyPing · 安装更新前确认' : 'OnlyPing · 未保存内容', kind: 'warning', okLabel: host.update ? '安装并重启' : '仍然关闭', cancelLabel: '留在编辑器' })
}

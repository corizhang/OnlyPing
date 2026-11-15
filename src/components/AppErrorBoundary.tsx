import { Component, type ReactNode } from 'react'
import { getRecoveryProject } from '@/lib/crash-recovery'

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; downloadError: boolean }> {
  state = { failed: false, downloadError: false }
  static getDerivedStateFromError() { return { failed: true } }
  download = () => {
    try {
      const project = getRecoveryProject()
      if (!project) return
      const url = URL.createObjectURL(new Blob([JSON.stringify(project)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = 'OnlyPing-故障恢复备份.json'; anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch { this.setState({ downloadError: true }) }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return <main className="flex min-h-screen items-center justify-center bg-neutral-900 p-8 text-neutral-100"><section role="alert" className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">编辑器遇到异常</h1>
      <p>本地存档未被清除。请先下载恢复备份，再重新加载编辑器。</p>
      <p className="text-sm text-neutral-400">恢复备份包含最后一次同步到项目状态的内容；尚未结束的文字编辑和拖动可能不包含在内。重新加载将尝试读取最近成功保存的本地存档。</p>
      <div className="flex gap-3">{getRecoveryProject() && <button className="rounded bg-blue-600 px-4 py-2" onClick={this.download}>下载恢复备份</button>}<button className="rounded border border-neutral-600 px-4 py-2" onClick={() => window.location.reload()}>重新加载编辑器</button></div>
      {this.state.downloadError && <p>备份下载失败，请保留此页面并检查浏览器下载设置。</p>}
    </section></main>
  }
}

// Isolated manual crash test: no project storage reads or writes. Dev server only.
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import AppErrorBoundary from '../src/components/AppErrorBoundary'
import { setRecoveryProject } from '../src/lib/crash-recovery'
import { DEFAULT_EXPORT_FOOTER, DEFAULT_EXPORT_STYLE } from '../src/types'
import '../src/index.css'

export default function Editor() {
  const [crash, setCrash] = useState(false)
  useEffect(() => setRecoveryProject({ schemaVersion: 1, projectId: 'qa-crash-recovery', title: 'QA 未保存内容', pages: [], exportStyle: DEFAULT_EXPORT_STYLE, exportFooter: DEFAULT_EXPORT_FOOTER }), [])
  if (crash) throw new Error('Intentional isolated QA crash')
  return <button onClick={() => setCrash(true)}>触发测试异常</button>
}
createRoot(document.getElementById('root')!).render(<AppErrorBoundary><Editor /></AppErrorBoundary>)

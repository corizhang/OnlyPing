import { lazy, Suspense } from 'react'
import type { ContentParametersProps } from './ContentStyleControls'
const Controls = lazy(() => import('./ContentStyleControls'))
/** Load font and badge controls only when a relevant tool or object is selected. */
export default function ContentParameters(props: ContentParametersProps) {
  return <Suspense fallback={<span className="shrink-0 text-xs text-[#999]" role="status">加载样式…</span>}><Controls {...props} /></Suspense>
}

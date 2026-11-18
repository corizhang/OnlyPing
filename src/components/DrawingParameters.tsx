import { lazy, Suspense } from 'react'
import type { DrawingParametersProps } from './DrawingStyleControls'
const Controls=lazy(()=>import('./DrawingStyleControls'))
export default function DrawingParameters(props:DrawingParametersProps){return <Suspense fallback={<span role="status" className="shrink-0 text-xs text-[#999]">加载样式…</span>}><Controls {...props}/></Suspense>}

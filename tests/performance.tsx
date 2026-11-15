// Manual dev-only diagnostics. Use a dedicated origin with synthetic projects.
// Counts actual input-to-two-animation-frame intervals and sampled JS heap;
// it does not claim paint completion, GPU memory or process peak memory.
import { createRoot } from 'react-dom/client'
import Home from '../src/pages/Home'
import AppErrorBoundary from '../src/components/AppErrorBoundary'
import '../src/index.css'

createRoot(document.getElementById('root')!).render(<AppErrorBoundary><Home /></AppErrorBoundary>)
const panel = document.createElement('aside')
panel.setAttribute('aria-label', '性能测量')
panel.style.cssText = 'position:fixed;bottom:50px;left:60px;z-index:9999;width:360px;background:#181818;color:#eee;padding:12px;font:12px/1.6 monospace;border:1px solid #666;'
panel.innerHTML = '<button type="button">开始测量</button> <button type="button">停止测量</button><pre aria-live="off" style="white-space:pre-wrap"></pre>'
document.body.appendChild(panel)
const [start, stop] = panel.querySelectorAll('button'), output = panel.querySelector('pre')!
let running = false, epoch = 0, samples: number[] = [], longTasks = 0, maxTask = 0, heapStart = 0, heapMax = 0
const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0
function report() {
  if (running) heapMax = Math.max(heapMax, heap())
  const sorted = [...samples].sort((a, b) => a - b)
  const quantile = (p: number) => sorted.length ? sorted[Math.ceil(p * sorted.length) - 1].toFixed(1) : '—'
  output.textContent = `${running ? '测量中' : '已停止'} · ${samples.length} 个输入事件\n输入→两帧 p50/p95：${quantile(.5)} / ${quantile(.95)} ms\n长任务：${longTasks}，最长 ${maxTask.toFixed(1)} ms\nJS 堆起始/采样最大/当前：${heapStart ? [heapStart, heapMax, heap()].map(n => (n / 1048576).toFixed(1)).join(' / ') + ' MB' : '此浏览器未提供'}\n开发模式测量；不是完整绘制延迟或进程内存。`
}
start.onclick = () => { epoch++; samples = []; longTasks = 0; maxTask = 0; heapStart = heap(); heapMax = heapStart; running = true; report() }
stop.onclick = () => { running = false; epoch++; report() }
for (const event of ['click', 'input', 'pointerup', 'keydown']) document.addEventListener(event, e => {
  if (!running || panel.contains(e.target as Node)) return
  const at = performance.now(), current = epoch
  requestAnimationFrame(() => requestAnimationFrame(() => { if (running && current === epoch) samples.push(performance.now() - at) }))
}, true)
if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) new PerformanceObserver(list => {
  if (!running) return
  for (const entry of list.getEntries()) { longTasks++; maxTask = Math.max(maxTask, entry.duration) }
}).observe({ type: 'longtask' })
setInterval(report, 500)
report()

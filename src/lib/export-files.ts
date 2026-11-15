import { checkTask, taskCheckpoint, type RenderTask } from './render-task.ts'

/** One browser download even when a long document requires multiple images. */
export async function packageLongImages(title: string, images: Blob[], task: RenderTask = {}) {
  checkTask(task)
  const name = title || '明白纸'
  if (!images.length) throw new Error('没有可导出的长图')
  if (images.length === 1) return { blob: images[0], filename: `${name}-长图.png` }
  const { default: JSZip } = await import('jszip')
  checkTask(task)
  const zip = new JSZip()
  // Keep user titles out of ZIP paths: slashes and dots must not create folders.
  for (let i = 0; i < images.length; i++) {
    await taskCheckpoint(task, '正在打包长图', i, images.length)
    const bytes = await images[i].arrayBuffer()
    checkTask(task)
    zip.file(`长图-${String(i + 1).padStart(3, '0')}.png`, bytes)
  }
  const buffer = await zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' }, () => checkTask(task))
  checkTask(task)
  return { blob: new Blob([buffer], { type: 'application/zip' }), filename: `${name}-长图.zip` }
}

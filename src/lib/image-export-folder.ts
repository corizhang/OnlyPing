import { IMAGE_EXPORT_MAX_BYTES, IMAGE_EXPORT_MAX_PAGES, type ImageExportJob, type ImageExportDimensions, type ImageExportEncoding } from './image-export.ts'
import { checkTask, isTaskCancelled, taskCheckpoint, type RenderTask } from './render-task.ts'
import type { Page } from '../types/index.ts'
import { ImageExportFailure, type ImageExportReport } from './image-export-result.ts'

export interface ImageFolderHost {
  begin: (names: string[]) => Promise<{ id: string; path: string } | null>
  write: (id: string, index: number, bytes: Uint8Array) => Promise<void>
  end: (id: string) => Promise<void>
}

/** Each image is committed independently. Cancel/failure preserves completed files and reports them. */
export async function writeImagesToFolder(jobs: ImageExportJob[], render: (page: Page, start: number, task: RenderTask, dimensions: ImageExportDimensions, encoding: ImageExportEncoding) => Promise<Blob>, host: ImageFolderHost, task: RenderTask = {}) {
  checkTask(task)
  if (!jobs.length || jobs.length > IMAGE_EXPORT_MAX_PAGES) throw new Error('每批请选择 1–1000 张图片')
  await taskCheckpoint(task, '请选择图片导出的目标文件夹', 0, jobs.length)
  const destination = await host.begin(jobs.map(job => job.filename))
  if (!destination) throw new DOMException('已取消选择文件夹，未写入图片', 'AbortError')
  let saved = 0, bytes = 0, failure: unknown
  try {
    checkTask(task)
    for (const job of jobs) {
      await taskCheckpoint(task, `正在保存第 ${job.index + 1} 张「${job.page.name}」`, saved, jobs.length)
      const blob = await render(job.page, job.numberStart, task, job.dimensions, job.encoding)
      checkTask(task)
      bytes += blob.size
      if (!blob.size || bytes > IMAGE_EXPORT_MAX_BYTES) throw new Error('图片为空或本批图片合计超过 200 MiB，请分批导出')
      const data = new Uint8Array(await blob.arrayBuffer())
      checkTask(task)
      await host.write(destination.id, saved, data)
      saved++
      checkTask(task)
    }
    await taskCheckpoint(task, '标注图片已保存到文件夹', saved, jobs.length)
  } catch (error) { failure = error }
  try { await host.end(destination.id) } catch (error) { if (!failure) failure = error }
  if (!failure) { try { checkTask(task) } catch (error) { failure = error } }
  if (failure) {
    const detail = `已保存 ${saved}/${jobs.length} 张至 ${destination.path}。已完成的图片保留；重新导出会新建目录。${failure instanceof Error ? failure.message : String(failure)}`
    const next = jobs[saved]
    const cancelled = isTaskCancelled(failure)
    const message = `${!cancelled && next ? `第 ${next.index + 1} 张「${next.page.name}」导出失败。` : !cancelled ? '导出收尾失败。' : ''}${detail}`
    throw new ImageExportFailure(message, { status: cancelled ? 'cancelled' : 'failed', total: jobs.length, completed: saved, delivery: 'folder', directory: destination.path, locationId: destination.id, message, failedImage: !cancelled && next ? { index: next.index, name: next.page.name } : undefined, pending: jobs.slice(saved).map(job => ({ index: job.index, name: job.page.name })) })
  }
  return { directory: destination.path, saved, report: { status: 'success', total: jobs.length, completed: saved, delivery: 'folder', directory: destination.path, locationId: destination.id, pending: [] } satisfies ImageExportReport }
}

import type { Page } from '@/types'
import { uid } from '@/types'

export interface FileImportFailure {
  name: string
  reason: string
}

export interface FileImportResult {
  pages: Page[]
  failures: FileImportFailure[]
  skipped: string[]
}

/**
 * 把图片文件转为页面对象。
 * 通过 canvas 重编码为 PNG：去除 EXIF 等元数据（拍摄设备、位置、时间等），同时统一格式。
 */
export function fileToPage(file: File): Promise<Page> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0)
          resolve({
            id: uid(),
            name: file.name.replace(/\.[^.]+$/, ''),
            image: canvas.toDataURL('image/png'),
            width: img.naturalWidth,
            height: img.naturalHeight,
            notes: '',
            annotations: [],
          })
        } catch (err) {
          reject(err instanceof Error ? err : new Error('图片处理失败'))
        }
      }
      img.onerror = () => reject(new Error(`无法读取图片：${file.name}`))
      img.src = String(reader.result)
    }
    reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`))
    reader.readAsDataURL(file)
  })
}

/** 过滤图片文件并逐个转换；单个失败不阻塞其余 */
export async function filesToPages(files: Iterable<File>): Promise<FileImportResult> {
  const allFiles = Array.from(files)
  const images = allFiles.filter((f) => f.type.startsWith('image/'))
  const skipped = allFiles.filter((f) => !f.type.startsWith('image/')).map((f) => f.name)
  const results = await Promise.allSettled(images.map(fileToPage))
  const pages: Page[] = []
  const failures: FileImportFailure[] = []
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') pages.push(result.value)
    else failures.push({
      name: images[index].name,
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
    })
  })
  return { pages, failures, skipped }
}

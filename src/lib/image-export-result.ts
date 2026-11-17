export interface ImageExportReport {
  status: 'success' | 'cancelled' | 'failed'
  total: number
  completed: number
  delivery: 'folder' | 'native-file' | 'download'
  directory?: string
  filename?: string
  path?: string
  locationId?: string
  message?: string
  failedImage?: { index: number; name: string }
  pending: { index: number; name: string }[]
}
export class ImageExportFailure extends Error {
  report: ImageExportReport
  constructor(message: string, report: ImageExportReport) {
    super(message)
    this.report = report
    this.name = report.status === 'cancelled' ? 'AbortError' : 'ImageExportFailure'
  }
}
export class ImageExportImageFailure extends Error {
  image: { index: number; name: string }
  constructor(message: string, image: { index: number; name: string }) { super(message); this.image = image }
}

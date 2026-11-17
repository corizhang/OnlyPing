import { DEFAULT_IMAGE_EXPORT_OPTIONS, imageExportDimensions, type ImageExportOptions } from './image-export.ts'
const KEY = 'onlyping:image-export-preferences:v1'
interface Storage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export const defaultImageExportPreferences = (): ImageExportOptions => structuredClone({ ...DEFAULT_IMAGE_EXPORT_OPTIONS, format: 'png', quality: 90, destination: 'download' })
function normalize(value: unknown, desktop: boolean): ImageExportOptions {
  if (!value || typeof value !== 'object') throw Error('Invalid preferences')
  const input = value as ImageExportOptions
  imageExportDimensions(100, 100, input.size)
  if (!['project', 'per-image'].includes(input.numbering) || !['png', 'jpeg'].includes(input.format ?? '') || !Number.isInteger(input.quality) || input.quality! < 1 || input.quality! > 100 || !['download', 'folder'].includes(input.destination ?? '')) throw Error('Invalid preferences')
  return { size: input.size.mode === 'original' ? { mode: 'original' } : { mode: input.size.mode, value: input.size.value }, numbering: input.numbering, format: input.format, quality: input.quality, destination: desktop ? input.destination : 'download' }
}
export function readImageExportPreferences(desktop: boolean, storage?: Storage): ImageExportOptions {
  try {
    const raw = (storage ?? localStorage).getItem(KEY)
    if (!raw || raw.length > 2048) return defaultImageExportPreferences()
    const record = JSON.parse(raw)
    if (record.version !== 1) return defaultImageExportPreferences()
    return normalize(record.options, desktop)
  } catch { return defaultImageExportPreferences() }
}
export function saveImageExportPreferences(options: ImageExportOptions, storage?: Storage): boolean {
  try { (storage ?? localStorage).setItem(KEY, JSON.stringify({ version: 1, options: normalize(options, true) })); return true } catch { return false }
}

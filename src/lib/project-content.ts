import type { ProjectData } from './db.ts'
import { DEFAULT_EXPORT_STYLE, DEFAULT_EXPORT_FOOTER } from '../types/index.ts'
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonical(item ?? null)).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
async function digest(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('') }
let pages = new WeakMap<object, Promise<string>>()
const images = new Map<string, Promise<string>>()
function imageDigest(value: string) {
  const cached = images.get(value)
  if (cached) { images.delete(value); images.set(value, cached); return cached }
  const hash = digest(value)
  if (value.length <= 32 * 1024 * 1024) {
    images.set(value, hash)
    while (images.size > 12 || [...images.keys()].reduce((sum, key) => sum + key.length * 2, 0) > 64 * 1024 * 1024) images.delete(images.keys().next().value!)
    void hash.catch(() => { if (images.get(value) === hash) images.delete(value) })
  }
  return hash
}
export function clearProjectContentCache() { pages = new WeakMap(); images.clear() }
/** Page owners are immutable; weak keys avoid retaining discarded screenshot strings. */
export async function projectContentHash(data: ProjectData): Promise<string> {
  const hashes = []
  for (const page of data.pages) {
    let hash = pages.get(page)
    if (!hash) {
      hash = (async () => digest(canonical({ ...page, image: await imageDigest(page.image), orig: page.orig ? { ...page.orig, image: await imageDigest(page.orig.image) } : undefined })))()
      pages.set(page, hash); void hash.catch(() => pages.delete(page))
    }
    hashes.push(await hash)
  }
  const { imageScale, ...style } = data.exportStyle
  return digest(canonical({ title: data.title, pages: hashes, exportStyle: { ...DEFAULT_EXPORT_STYLE, ...style, stepImageScale: style.stepImageScale ?? imageScale ?? DEFAULT_EXPORT_STYLE.stepImageScale }, exportFooter: { ...DEFAULT_EXPORT_FOOTER, ...data.exportFooter } }))
}

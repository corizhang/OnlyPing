import { checkTask } from './render-task.ts'
export { footerText } from './export-common.ts'
export async function exportAnnotatedImages(...args: Parameters<typeof import('./export-annotated-images').exportAnnotatedImages>) {
  checkTask(args[2])
  const engine = await import('./export-annotated-images')
  checkTask(args[2])
  return engine.exportAnnotatedImages(...args)
}

/** Lightweight entry points. Load format-specific engines only on demand. */
export async function exportDocx(...args: Parameters<typeof import('./export-word').exportDocx>) {
  checkTask(args[5])
  const engine = await import('./export-word')
  checkTask(args[5])
  return engine.exportDocx(...args)
}
export async function exportPdf(...args: Parameters<typeof import('./export-document').exportPdf>) {
  checkTask(args[5])
  const engine = await import('./export-document')
  checkTask(args[5])
  return engine.exportPdf(...args)
}
export async function exportLongImage(...args: Parameters<typeof import('./export-document').exportLongImage>) {
  checkTask(args[5])
  const engine = await import('./export-document')
  checkTask(args[5])
  return engine.exportLongImage(...args)
}
export async function renderDocument(...args: Parameters<typeof import('./export-layout').renderDocument>) {
  checkTask(args[6])
  const engine = await import('./export-layout')
  checkTask(args[6])
  return engine.renderDocument(...args)
}

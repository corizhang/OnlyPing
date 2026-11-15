export interface NativeFilesHost {
  save: (options: { title: string; defaultPath: string; filters: { name: string; extensions: string[] }[] }) => Promise<string | null>
  open: (options: { title: string; multiple: false; filters: { name: string; extensions: string[] }[] }) => Promise<string | string[] | null>
  readFile: (path: string) => Promise<Uint8Array>
  writeFile: (path: string, data: Uint8Array) => Promise<void>
}

export function safeFilename(name: string) {
  const clean = name.replace(/[<>:"/\\|?*]/g, '_').replace(/\p{Cc}/gu, '_').replace(/[. ]+$/, '') || 'OnlyPing'
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean
}

export function createNativeFiles(host: NativeFilesHost) {
  return {
    async save(blob: Blob, filename: string, signal?: AbortSignal) {
      signal?.throwIfAborted()
      filename = safeFilename(filename)
      const extension = filename.split('.').pop()?.toLowerCase() ?? ''
      const path = await host.save({ title: '保存文件', defaultPath: filename, filters: [{ name: extension.toUpperCase() || '文件', extensions: [extension || '*'] }] })
      signal?.throwIfAborted()
      if (path === null) throw new DOMException('已取消保存', 'AbortError')
      const data = new Uint8Array(await blob.arrayBuffer())
      signal?.throwIfAborted()
      // Only a path explicitly returned by a native user picker is written.
      await host.writeFile(path, data)
    },
    async openProject(): Promise<File | null> {
      const path = await host.open({ title: '打开 OnlyPing 项目', multiple: false, filters: [{ name: 'OnlyPing 项目', extensions: ['json'] }] })
      if (path === null) return null
      if (typeof path !== 'string') throw new Error('请选择单个项目文件')
      const bytes = await host.readFile(path)
      return new File([new Uint8Array(bytes).buffer], path.split(/[\\/]/).pop() ?? 'project.json', { type: 'application/json' })
    },
  }
}

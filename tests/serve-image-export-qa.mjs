// Loopback-only synthetic artifact collector. Not imported by the application/build.
import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const origin = 'http://127.0.0.1:3011'
const allowed = new Set(['single.png', 'specified.zip', 'all.zip', 'row.png', 'half.png', 'limited.zip', 'restart.png', 'single.jpg', 'jpeg.zip', 'white.jpg', 'quality-low.jpg', 'quality-high.jpg', 'preview.jpg', 'preview.png', 'report.json'])
export async function createImageExportQAServer(directory) {
  await mkdir(directory, { recursive: true })
  return createServer(async (request, response) => {
    if (request.headers.origin !== origin) { response.writeHead(403); response.end('QA origin required'); return }
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
    const name = request.url?.startsWith('/artifact/') ? request.url.slice('/artifact/'.length) : ''
    if (request.method !== 'POST' || !allowed.has(name)) { response.writeHead(404); response.end(); return }
    try {
      const chunks = []; let length = 0
      for await (const chunk of request) {
        length += chunk.length
        if (length > 5 * 1048576) { response.writeHead(413); response.end('Synthetic artifact too large'); return }
        chunks.push(chunk)
      }
      await writeFile(join(directory, name), Buffer.concat(chunks))
      response.writeHead(200); response.end('saved')
    } catch { if (!response.headersSent) response.writeHead(500); response.end('QA write failed') }
  })
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const directory = fileURLToPath(new URL('../src-tauri/target/image-export-qa/', import.meta.url))
  const server = await createImageExportQAServer(directory)
  server.listen(3012, '127.0.0.1', () => process.stdout.write(`Image QA collector: 127.0.0.1:3012 -> ${directory}\n`))
}

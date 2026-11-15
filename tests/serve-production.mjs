// Local production-artifact QA server, with optional deliberate chunk failures.
// Not a production hosting service. Binds loopback only.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

export function productionQAServer({ root = fileURLToPath(new URL('../dist/', import.meta.url)), fail = '' } = {}) {
  root = resolve(root)
  let failure = fail
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
      const target = resolve(root, `.${path === '/' ? '/index.html' : path}`)
      if (target !== root && !target.startsWith(root + sep)) { response.writeHead(403); response.end(); return }
      if (failure && path.startsWith('/assets/') && path.split('/').at(-1).startsWith(failure)) {
        response.writeHead(404, { 'Cache-Control': 'no-store' }); response.end('Deliberate QA chunk failure'); return
      }
      let body, file = target
      try { body = await readFile(file) }
      catch {
        if (extname(path) || path.startsWith('/assets/')) { response.writeHead(404, { 'Cache-Control': 'no-store' }); response.end('Not found'); return }
        file = resolve(root, 'index.html'); body = await readFile(file)
      }
      response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' })
      response.end(body)
    } catch { response.writeHead(400, { 'Cache-Control': 'no-store' }); response.end('Bad request') }
  })
  return { server, setFailure: prefix => { failure = prefix } }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = (key, fallback) => process.argv.find(a => a.startsWith(`--${key}=`))?.split('=').slice(1).join('=') ?? fallback
  const qa = productionQAServer({ fail: option('fail', '') })
  qa.server.listen(Number(option('port', '3007')), '127.0.0.1', () => console.log(`QA production server: http://127.0.0.1:${qa.server.address().port}/`))
  createInterface({ input: process.stdin }).on('line', command => {
    if (command === 'restore') { qa.setFailure(''); console.log('QA faults disabled') }
    if (command.startsWith('fail ')) { qa.setFailure(command.slice(5)); console.log('QA fault updated') }
    if (command === 'stop') qa.server.close(() => process.exit(0))
  })
}

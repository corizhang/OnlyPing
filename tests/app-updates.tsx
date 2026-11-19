import { createRoot } from 'react-dom/client'
import AppUpdateCard from '../src/components/AppUpdateCard'
import { createUpdateController } from '../src/lib/update-controller'
import '../src/index.css'
if (location.origin !== 'http://127.0.0.1:3011') throw Error('Use isolated QA origin')
let checks = 0, installs = 0, downloads = 0, blocked = true
let releaseDownload: (() => void) | undefined
let progress: ((value: { downloaded: number; total: number }) => void) | undefined
const controller = createUpdateController({
  info: async () => ({ currentVersion: '0.1.2', configured: true }),
  check: async () => { checks++; return { version: '0.1.3', notes: '改进窗口恢复\n修复标注编辑\n此页面使用模拟更新服务，不下载安装真实程序。' } },
  download: callback => { downloads++; progress = callback; return new Promise(resolve => { releaseDownload = resolve }) },
  cancel: async () => releaseDownload?.(), beforeInstall: async () => !blocked,
  install: async () => { installs++ }, available: () => {},
})
const unconfigured = createUpdateController({ info: async () => ({ currentVersion: '0.1.2', configured: false, reason: '更新服务尚未配置，当前可通过安装包手动升级' }), check: async () => { throw Error('must not check') }, download: async () => {}, cancel: async () => {}, beforeInstall: async () => false, install: async () => {}, available: () => {} })
createRoot(document.getElementById('root')!).render(<div className="mx-auto max-w-3xl space-y-8 p-10 text-[#ddd]"><h1 className="text-xl">OnlyPing 更新流程 · 隔离验收</h1><div id="configured" className="rounded border border-white/10 bg-[#282828] p-6"><AppUpdateCard controller={controller} /></div><div id="unconfigured" className="rounded border border-white/10 bg-[#282828] p-6"><AppUpdateCard controller={unconfigured} /></div><p id="result" role="status">正在验收…</p></div>)
const wait = () => new Promise(resolve => setTimeout(resolve, 40))
async function until(check: () => boolean) { for (let i = 0; i < 100; i++) { if (check()) return; await wait() } throw Error('Timed out') }
const check = (value: unknown, label: string) => { if (!value) throw Error(label) }
async function click(text: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('#configured button')].find(b => b.textContent === text); if (!button) throw Error(`Missing ${text}`); button.click(); await wait() }
async function run() {
  await until(() => !!controller.getSnapshot().info && !!unconfigured.getSnapshot().info)
  check((document.querySelector('#unconfigured button') as HTMLButtonElement).disabled, 'unconfigured button disabled')
  await click('检查更新'); check(checks === 1 && !!document.querySelector('#configured')?.textContent?.includes('0.1.3'), 'check metadata')
  await click('下载更新'); progress?.({ downloaded: 5 * 1024 * 1024, total: 10 * 1024 * 1024 }); await wait()
  check(document.querySelector('#configured')?.textContent?.includes('50%'), 'progress')
  await click('取消下载'); await until(() => controller.getSnapshot().phase === 'available')
  check(installs === 0 && downloads === 1, 'cancel never installs')
  await click('下载更新'); releaseDownload?.(); await until(() => controller.getSnapshot().phase === 'ready')
  await click('安装并重启'); check(controller.getSnapshot().phase === 'ready' && installs === 0, 'save guard prevents install')
  blocked = false; await click('安装并重启'); check(installs === 1, 'only explicit approved installation executes')
  document.getElementById('result')!.textContent = 'PASS · 6 项更新界面流程验证（模拟服务，无真实安装）'
}
void run().catch(error => { document.getElementById('result')!.textContent = `FAIL · ${error.message}` })

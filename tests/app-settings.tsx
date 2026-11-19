// Isolated browser fixture: native IPC/events are mocked, never a claim of real tray-click QA.
import { createRoot } from 'react-dom/client'
import { StrictMode, useState } from 'react'
import { mockIPC } from '@tauri-apps/api/mocks'
import { emit } from '@tauri-apps/api/event'
import AppSettings from '../src/components/AppSettings'
import { useDesktopClose } from '../src/hooks/use-desktop-close'
import { readImageExportPreferences } from '../src/lib/image-export-preferences'
import type { DesktopPreferences } from '../src/lib/desktop-lifecycle'
import '../src/index.css'
if (location.origin !== 'http://127.0.0.1:3011') throw Error('Use isolated QA origin')
Object.assign(globalThis, { isTauri: true })
let preferences: DesktopPreferences = { closeBehavior: 'ask', minimizeToTray: false, rememberWindow: true, autoCheckUpdates: true }
let failSave = false, resets = 0, hideGuards = 0, exitGuards = 0, settingsEvents = 0
const actions: string[] = [], reports: string[] = []
mockIPC((command, payload) => {
  if (command === 'desktop_preferences') return { preferences: { ...preferences }, trayAvailable: true }
  if (command === 'desktop_save_preferences') { if (failSave) throw Error('模拟磁盘写入失败'); preferences = (payload as { preferences: DesktopPreferences }).preferences; return }
  if (command === 'desktop_close_action') { actions.push((payload as { action: string }).action); return }
  if (command === 'workspace_info') return { directory: 'D:\\OnlyPing-QA\\项目', projects: [] }
  if (command === 'project_storage_location') return 'C:\\OnlyPing-QA\\恢复存档'
  if (command === 'project_storage_open_directory') return
  if (command === 'app_update_info') return { currentVersion: '0.1.2', configured: false, reason: '更新服务尚未配置' }
  if (command === 'write_ai_key') return
  throw Error(`Unexpected native command: ${command}`)
}, { shouldMockEvents: true })
export function Harness() {
  const [privacy, setPrivacy] = useState(true), [scan, setScan] = useState(false)
  const [config, setConfig] = useState({ baseUrl: 'https://example.invalid/v1', apiKey: '', model: 'qa-vision', demo: true, keyStorage: 'session' as 'session' | 'local' })
  useDesktopClose(async () => { exitGuards++; return true }, () => { throw Error('Desktop lifecycle failed') }, {
    beforeHide: async () => { hideGuards++; return true },
    choose: async () => ({ behavior: 'tray', remember: false }), settings: () => { settingsEvents++ },
  })
  return <AppSettings initialSection="general" onClose={() => {}} onDirectory={async () => {}} onLibrary={() => {}} onResetLayout={() => resets++} onResetTools={() => resets++} onResetStyles={() => resets++} onReorder={() => {}} onShortcuts={() => {}} config={config} onConfigChange={setConfig} aiReady privacy={privacy} onPrivacyChange={setPrivacy} autoScan={scan} onAutoScanChange={setScan} aiBusy={false} />
}
createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
const delay = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms))
async function until(check: () => boolean, label: string) { for (let i = 0; i < 100; i++) { if (check()) return; await delay(25) } throw Error(label) }
const select = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement
async function changeSelect(label: string, value: string) { select(label).value = value; select(label).dispatchEvent(new Event('change', { bubbles: true })); await delay() }
async function button(text: string) { const item = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === text); if (!item) throw Error(`Missing button ${text}`); item.click(); await delay() }
function check(condition: unknown, label: string) { if (!condition) throw Error(label); reports.push(label) }
async function run() {
  await until(() => !!select('关闭主窗口时') && !select('关闭主窗口时').closest('fieldset')!.disabled, 'settings loaded')
  check(select('关闭主窗口时').value === 'ask', '常规设置读取')
  await changeSelect('关闭主窗口时', 'tray'); check(preferences.closeBehavior === 'tray', '关闭偏好保存并同步')
  ;(document.querySelector('[aria-label="最小化到托盘"]') as HTMLButtonElement).click(); await delay()
  check(preferences.minimizeToTray, '最小化偏好保存')
  ;(document.querySelector('[aria-label="记住窗口布局"]') as HTMLButtonElement).click(); await delay()
  check(!preferences.rememberWindow, '窗口记忆偏好关闭并保存')
  ;(document.querySelector('[aria-label="记住窗口布局"]') as HTMLButtonElement).click(); await delay()
  check(preferences.rememberWindow, '窗口记忆偏好重新启用')
  ;(document.querySelector('[aria-label="启动后自动检查更新"]') as HTMLButtonElement).click(); await delay()
  check(!preferences.autoCheckUpdates, '自动更新检查偏好关闭')
  ;(document.querySelector('[aria-label="启动后自动检查更新"]') as HTMLButtonElement).click(); await delay()
  check(preferences.autoCheckUpdates, '自动更新检查偏好重新启用')
  failSave = true; await changeSelect('关闭主窗口时', 'exit'); check(select('关闭主窗口时').value === 'tray', '写入失败保留旧值'); failSave = false
  await button('项目与存储'); check(document.body.textContent?.includes('OnlyPing-QA'), '项目目录与恢复目录展示')
  await button('编辑器'); const reset = [...document.querySelectorAll('button')].filter(b => b.textContent?.trim() === '恢复默认')[0]; reset.click(); await delay(); await button('取消'); check(resets === 0, '恢复默认取消不生效')
  reset.click(); await delay(); await button('确认恢复'); check(resets === 1, '恢复默认确认后生效')
  await button('图片导出'); await changeSelect('默认图片格式', 'jpeg'); await button('保存导出默认值'); check(readImageExportPreferences(true).format === 'jpeg', '导出默认值写入原偏好存储')
  await changeSelect('默认图片尺寸', 'percent'); await button('保存导出默认值'); check(readImageExportPreferences(true).size.mode === 'percent', '图片缩放偏好整合')
  await button('AI 与隐私'); const privacy = document.querySelector('[aria-label="发送完整标注图"]') as HTMLButtonElement; privacy.click(); await delay(); check(privacy.getAttribute('aria-checked') === 'false', 'AI 隐私状态同步')
  await button('保存 AI 配置'); check(document.body.textContent?.includes('AI 配置已保存'), 'AI 配置复用现有安全存储流程')
  await emit('onlyping-close', 'close'); await delay(); check(hideGuards === 1 && actions.at(-1) === 'hide', '关闭事件先保存恢复存档再隐藏')
  await emit('onlyping-close', 'exit'); await delay(); check(exitGuards === 1 && actions.at(-1) === 'exit', '托盘退出绕过隐藏偏好并执行退出检查')
  await emit('onlyping-settings'); await delay(); check(settingsEvents === 1, 'StrictMode 订阅清理避免事件重复处理')
  await button('关于'); await delay(); check(document.body.textContent?.includes('更新服务尚未配置'), '关于页明确展示更新未配置状态')
  await button('常规')
  const result = document.createElement('div'); result.id = 'qa-result'; result.textContent = `PASS · ${reports.length} 项设置与桌面事件验证`; result.style.cssText = 'position:fixed;left:16px;top:12px;z-index:100;color:#86efac;font:14px sans-serif'; document.body.append(result)
  Object.assign(window, { settingsQA: { passed: true, reports } })
}
void run().catch(error => { const result = document.createElement('pre'); result.id = 'qa-result'; result.textContent = `FAIL: ${error.message}`; result.style.cssText = 'position:fixed;left:8px;top:0;z-index:100;color:#f87171'; document.body.append(result); Object.assign(window, { settingsQA: { passed: false, reports, error: error.message } }) })

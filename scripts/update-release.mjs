import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
export const UPDATE_ENDPOINT = 'https://github.com/corizhang/OnlyPing/releases/latest/download/latest.json'
export function validatePublicKey(key) {
  if (typeof key !== 'string' || key.length < 40 || key.length > 4096 || !/^[A-Za-z0-9+/=]+$/.test(key)) throw Error('ONLYPING_UPDATER_PUBLIC_KEY 必须是 Tauri 生成的 base64 公钥')
  const lines = Buffer.from(key, 'base64').toString('utf8').trim().split(/\r?\n/)
  const bytes = Buffer.from(lines[1] ?? '', 'base64')
  if (!lines[0]?.startsWith('untrusted comment:') || bytes.length !== 42 || bytes.subarray(0, 2).toString() !== 'Ed') throw Error('更新公钥格式无效')
  return key
}
export function validateVersions(pkg, config, cargo, tag) {
  const version = pkg.version
  const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1]
  if (!stable.test(version) || config.version !== version || cargoVersion !== version) throw Error('package.json、Tauri 和 Cargo 必须使用相同的正式 SemVer 版本号')
  if (tag && tag !== `v${version}`) throw Error('发布 tag 必须与应用版本一致')
  return version
}
export function releaseConfig(key) {
  return { bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: validatePublicKey(key), endpoints: [UPDATE_ENDPOINT], requireSignedVersion: true, allowDowngrades: false, windows: { installMode: 'passive' } } } }
}
export function updateManifest(version, signature, notes = '', date = new Date().toISOString()) {
  if (!stable.test(version)) throw Error('更新清单只接受正式版本')
  const lines = Buffer.from(signature.trim(), 'base64').toString('utf8').trim().split(/\r?\n/)
  const comment = lines[2] ?? ''
  if (!lines[0]?.startsWith('untrusted comment:') || Buffer.from(lines[1] ?? '', 'base64').length !== 74 || Buffer.from(lines[3] ?? '', 'base64').length !== 64 || !comment.startsWith('trusted comment:') || !new RegExp(`(?:^|\\s)version:${version.replaceAll('.', '\\.')}($|\\s)`).test(comment)) throw Error('签名必须绑定当前版本，请使用支持 --app-version 的 Tauri CLI 重新构建')
  if (!Number.isFinite(Date.parse(date))) throw Error('发布日期无效')
  return { version, notes: notes.slice(0, 32000), pub_date: date, platforms: { 'windows-x86_64': { signature: signature.trim(), url: `https://github.com/corizhang/OnlyPing/releases/download/v${version}/OnlyPing_${version}_x64-setup.exe` } } }
}
function run() {
  const version = validateVersions(JSON.parse(readFileSync(resolve(repo, 'package.json'))), JSON.parse(readFileSync(resolve(repo, 'src-tauri/tauri.conf.json'))), readFileSync(resolve(repo, 'src-tauri/Cargo.toml'), 'utf8'), process.env.RELEASE_TAG)
  const target = resolve(repo, 'src-tauri/target')
  mkdirSync(target, { recursive: true })
  if (process.argv[2] === 'prepare') {
    writeFileSync(resolve(target, 'update-release.config.json'), JSON.stringify(releaseConfig(process.env.ONLYPING_UPDATER_PUBLIC_KEY), null, 2))
    console.log(`已准备 ${version} 的签名发布配置（只包含公钥）`)
  } else if (process.argv[2] === 'manifest') {
    const installer = resolve(target, `release/bundle/nsis/OnlyPing_${version}_x64-setup.exe`)
    if (readFileSync(installer).length === 0) throw Error('安装包为空')
    const manifest = updateManifest(version, readFileSync(`${installer}.sig`, 'utf8'), process.env.RELEASE_NOTES ?? '')
    writeFileSync(resolve(target, 'latest.json'), JSON.stringify(manifest, null, 2))
    console.log(`已生成 ${version} 更新清单`)
  } else throw Error('使用 node scripts/update-release.mjs prepare 或 manifest')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { run() } catch (error) { console.error(error.message); process.exitCode = 1 }
}

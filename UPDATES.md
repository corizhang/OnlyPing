# Windows 应用内更新

## 当前状态

客户端已接入检查、下载进度、取消与重试、签名验证、安装前保存检查及 Windows NSIS 安装入口。设置 → 常规可关闭启动后自动检查；设置 → 关于可手动检查、查看版本说明、下载并选择何时安装。后台检查在启动约 10 秒后进行，检测到新版只提示，不自动下载或安装。

按本次约定，**尚未生成或配置正式签名密钥，也没有发布启用自动更新的版本**。仓库默认公钥为空，因此普通构建显示“更新服务尚未配置”，不请求更新清单，更不会声称已是最新版。QA 标识始终禁止使用正式更新服务。Web 入口不显示桌面更新操作。

## 更新与数据保护

- 检查、下载与安装由原生端串行处理；前端不能传入公钥、更新地址、安装路径或安装参数。
- 清单地址固定为 `https://github.com/corizhang/OnlyPing/releases/latest/download/latest.json`，仅接受本仓库 Releases 路径下的 HTTPS `.exe` 安装包。
- 下载完成必须经过 Tauri Updater 验签后才能显示“安装并重启”；安装时再次验证。启用 `requireSignedVersion`，拒绝签名中版本与清单版本不一致的包，不允许降级。
- 下载超时 10 分钟、最大 128MB，支持取消，失败可以重试。下载进度至多约每 100ms 推送一次。已下载的包只在当前运行内保留，退出后需重新下载。
- 安装前结算编辑输入并保存本机恢复存档；失败则停止更新。导出、文件操作或 AI 任务尚未结束时也停止。关联项目文件尚未写回或存在外部变化时，明确提示并允许返回处理。
- 准备安装时锁住设置关闭/切换和托盘退出，防止保存检查后继续编辑。Windows 使用带进度的 passive 安装模式，由官方 Updater 启动 NSIS 并请求安装后重新打开应用。

## 一次性正式配置（尚未执行）

1. 在受控电脑使用当前 Tauri CLI 生成长期密钥，保存在仓库以外。例如在项目目录手动执行：

   ```powershell
   npm run tauri -- signer generate -w "$env:USERPROFILE\.tauri\onlyping-updater.key"
   ```

   私钥和口令需要单独安全备份，不提交 Git、不粘贴到聊天。公钥可以公开。不要为每次发布重新生成密钥，已安装客户端信任的是随应用发布的公钥。Tauri 更新签名与 Windows Authenticode 代码签名是不同机制。

2. 在 GitHub 仓库创建 `release` Environment，建议启用发布审核，并配置：

   | 类型 | 名称 | 内容 |
   | --- | --- | --- |
   | Variable | `ONLYPING_UPDATER_PUBLIC_KEY` | Tauri `.pub` 文件中的完整 base64 公钥 |
   | Secret | `TAURI_SIGNING_PRIVATE_KEY` | 私钥内容 |
   | Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥口令，没有则为空 |

3. 发布前同步修改 `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 Cargo lock 中应用包版本。创建相同版本的标签，如 `v0.1.3`。当前代码是 `0.1.3-alpha.1`，本次按预发布分发；签名发布脚本只接受正式版本，本文示例不代表已经发布。

## 签名发布流程

`.github/workflows/release.yml` 仅手动触发。选择已存在的版本标签，填写应用内更新说明。流程会校验版本一致性与公钥格式，运行测试，生成临时发布配置，构建签名安装包，再生成 `latest.json`。

私钥只注入检查/签名构建步骤；准备脚本输出的 `src-tauri/target/update-release.config.json` 仅包含公钥。普通 `npm run desktop:build` 继续不生成更新签名，不依赖正式密钥。

发布流程上传以下审核产物并创建 **Draft Release**，不会自动公开发布：

- `OnlyPing_<版本>_x64-setup.exe`
- 同名 `.exe.sig`
- `latest.json`（内含版本、说明、版本固定的安装包 URL 和完整签名）

脚本校验签名结构及版本绑定；密码学验证由原生 Updater 完成。已有同标签 Release 时流程失败，不覆盖已发布文件。审核安装包、升级测试及签名配对后，手动发布为正式版本，GitHub 的 `/releases/latest` 才会供客户端读取。第一阶段只支持 Windows x64 正式版本，不混用 alpha/beta 通道。

本地签名构建也可使用相同脚本：先在环境变量中设置上述公钥、私钥/口令，再执行：

```powershell
node scripts/update-release.mjs prepare
npm run desktop:build -- --config src-tauri/target/update-release.config.json
node scripts/update-release.mjs manifest
```

私钥环境变量不要写入版本控制中的脚本或配置文件。

## 首次上线与验收

当前没有更新能力的旧程序，或默认空公钥构建，需要先手动安装一次**使用正式公钥签名配置构建**的新版，之后才能检测后续版本。配置 GitHub Secrets 不会让已经安装的空公钥程序自动启用更新。

上线前用两个不同版本执行完整升级：例如首次手动安装 0.1.3，再发布 0.1.4。至少检查发现更新、下载取消/重试、无效签名、错误版本绑定、断网、正在导出/中文输入、脏项目确认取消、安装权限取消、成功安装重启与项目/恢复存档保留。安装文件选择器、UAC/NSIS 和真实升级替换尚未验收，本次没有用正式密钥或真实安装包执行替换。

隔离回归入口：`http://127.0.0.1:3011/tests/app-updates.html`，只允许该 QA origin。该页面模拟更新服务与安装动作，可验证界面与保存保护，但不等同于真实升级测试。

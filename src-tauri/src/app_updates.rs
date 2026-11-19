use serde::Serialize;
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU8, Ordering},
    },
    time::{Duration, Instant},
};
use tauri::ipc::Channel;
use tauri_plugin_updater::{Update, UpdaterExt};

const ENDPOINT: &str = "https://github.com/corizhang/OnlyPing/releases/latest/download/latest.json";
const MAX_PACKAGE: u64 = 128 * 1024 * 1024;
#[derive(Default)]
pub struct UpdateState {
    session: Mutex<Session>,
    busy: AtomicBool,
    downloading: AtomicBool,
    cancelled: AtomicU8,
    cancel: Mutex<Option<Arc<tokio::sync::Notify>>>,
}
#[derive(Default)]
struct Session {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
fn enter(state: &UpdateState) -> Result<Busy<'_>, String> {
    state
        .busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map_err(|_| "已有更新操作正在进行")?;
    Ok(Busy(&state.busy))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    configured: bool,
    reason: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    version: String,
    notes: String,
    date: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

fn configured(identifier: &str, updater: Option<&serde_json::Value>) -> bool {
    identifier == "io.github.corizhang.onlyping"
        && updater.is_some_and(|v| {
            v.get("pubkey")
                .and_then(|v| v.as_str())
                .is_some_and(|s| !s.trim().is_empty())
                && v.get("endpoints") == Some(&serde_json::json!([ENDPOINT]))
                && v.get("requireSignedVersion") == Some(&serde_json::Value::Bool(true))
                && ![
                    "dangerousInsecureTransportProtocol",
                    "dangerousAcceptInvalidCerts",
                    "dangerousAcceptInvalidHostnames",
                    "allowDowngrades",
                ]
                .iter()
                .any(|key| v.get(key).and_then(|v| v.as_bool()) == Some(true))
        })
}
#[tauri::command]
pub fn app_update_info(app: tauri::AppHandle) -> UpdateInfo {
    let enabled = configured(
        &app.config().identifier,
        app.config().plugins.0.get("updater"),
    );
    UpdateInfo {
        current_version: app.package_info().version.to_string(),
        configured: enabled,
        reason: (!enabled).then(|| {
            if app.config().identifier.ends_with(".qa") {
                "QA 应用不使用正式更新服务".into()
            } else {
                "更新服务尚未配置，当前可通过安装包手动升级".into()
            }
        }),
    }
}
fn require_config(app: &tauri::AppHandle) -> Result<(), String> {
    if app_update_info(app.clone()).configured {
        Ok(())
    } else {
        Err("更新服务尚未配置或此应用不支持正式更新".into())
    }
}
fn allowed_package(url: &str) -> bool {
    url.starts_with("https://github.com/corizhang/OnlyPing/releases/download/")
        && url.ends_with(".exe")
        && !url.contains(['?', '#', '\\'])
        && !url.contains("/../")
}
#[tauri::command]
pub async fn app_update_check(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
) -> Result<Option<Release>, String> {
    require_config(&app)?;
    let _busy = enter(&state)?;
    let updater = app
        .updater_builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "更新服务配置无效，请使用安装包升级")?;
    let mut update = updater
        .check()
        .await
        .map_err(|_| "无法检查更新，请检查网络或稍后重试")?;
    if let Some(value) = update.as_mut() {
        if !allowed_package(value.download_url.as_str()) || value.signature.trim().is_empty() {
            return Err("更新清单中的安装包地址或签名无效".into());
        }
        // Checking the feed should be quick; large package downloads get a separate timeout.
        value.timeout = Some(Duration::from_secs(600));
    }
    let metadata = update.as_ref().map(|u| Release {
        version: u.version.clone(),
        notes: u
            .body
            .clone()
            .unwrap_or_default()
            .chars()
            .take(32_000)
            .collect(),
        date: u.date.map(|d| d.to_string()),
    });
    *state.session.lock().map_err(|_| "更新状态不可用")? = Session {
        update,
        bytes: None,
    };
    Ok(metadata)
}
#[tauri::command]
pub async fn app_update_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdateState>,
    on_progress: Channel<Progress>,
) -> Result<(), String> {
    require_config(&app)?;
    let _busy = enter(&state)?;
    let update = {
        let mut session = state.session.lock().map_err(|_| "更新状态不可用")?;
        session.bytes = None;
        session.update.clone().ok_or("请先检查新版本")?
    };
    state.cancelled.store(0, Ordering::Release);
    let cancel = Arc::new(tokio::sync::Notify::new());
    *state.cancel.lock().map_err(|_| "更新状态不可用")? = Some(cancel.clone());
    let notified = cancel.notified();
    tokio::pin!(notified);
    notified.as_mut().enable();
    state.downloading.store(true, Ordering::Release);
    let mut downloaded = 0u64;
    let mut last_progress = Instant::now() - Duration::from_millis(100);
    let result: Result<Vec<u8>, String> = tokio::select! {
        biased;
        _ = &mut notified => Err(if state.cancelled.load(Ordering::Acquire) == 2 { "更新包超过 128MB 限制".into() } else { "已取消下载".into() }),
        result = update.download(|chunk, total| {
            downloaded = downloaded.saturating_add(chunk as u64);
            if downloaded > MAX_PACKAGE || total.is_some_and(|n| n > MAX_PACKAGE) { state.cancelled.store(2, Ordering::Release); cancel.notify_one(); }
            if last_progress.elapsed() >= Duration::from_millis(100) || total == Some(downloaded) {
                let _ = on_progress.send(Progress { downloaded, total }); last_progress = Instant::now();
            }
        }, || {}) => result.map_err(|_| "下载失败或签名验证未通过，请重试；原应用保持不变".into()),
    };
    state.downloading.store(false, Ordering::Release);
    state.cancel.lock().map_err(|_| "更新状态不可用")?.take();
    let bytes = result?;
    if bytes.len() as u64 > MAX_PACKAGE || state.cancelled.load(Ordering::Acquire) != 0 {
        return Err("下载已取消或更新包过大".into());
    }
    state.session.lock().map_err(|_| "更新状态不可用")?.bytes = Some(bytes);
    Ok(())
}
#[tauri::command]
pub fn app_update_cancel(state: tauri::State<UpdateState>) {
    if state.downloading.load(Ordering::Acquire) {
        state.cancelled.store(1, Ordering::Release);
        if let Ok(cancel) = state.cancel.lock() {
            if let Some(cancel) = cancel.as_ref() {
                cancel.notify_one();
            }
        }
    }
}
#[tauri::command]
pub fn app_update_install(
    app: tauri::AppHandle,
    state: tauri::State<UpdateState>,
) -> Result<(), String> {
    require_config(&app)?;
    let _busy = enter(&state)?;
    let session = state.session.lock().map_err(|_| "更新状态不可用")?;
    let update = session.update.as_ref().ok_or("请先检查新版本")?;
    let bytes = session.bytes.as_ref().ok_or("请先下载并验证更新包")?;
    super::window_memory::flush(&app);
    // Tauri re-verifies the version-bound signature here before starting NSIS.
    update
        .install(bytes)
        .map_err(|_| "无法启动更新安装，请重试或手动下载安装包".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_key_qa_and_unsafe_config_cannot_enable_updates() {
        let mut value = serde_json::json!({"pubkey":"test-public-key", "endpoints":[ENDPOINT], "requireSignedVersion":true});
        assert!(configured("io.github.corizhang.onlyping", Some(&value)));
        assert!(!configured("io.github.corizhang.onlyping.qa", Some(&value)));
        value["allowDowngrades"] = true.into();
        assert!(!configured("io.github.corizhang.onlyping", Some(&value)));
        value["allowDowngrades"] = false.into();
        value["pubkey"] = "".into();
        assert!(!configured("io.github.corizhang.onlyping", Some(&value)));
        assert!(!configured("io.github.corizhang.onlyping", None));
    }
    #[test]
    fn only_https_installers_from_our_release_path_are_accepted() {
        assert!(allowed_package(
            "https://github.com/corizhang/OnlyPing/releases/download/v0.1.3/OnlyPing.exe"
        ));
        for url in [
            "http://github.com/corizhang/OnlyPing/releases/download/v1/a.exe",
            "https://github.com/other/app/releases/download/v1/a.exe",
            "https://github.com/corizhang/OnlyPing/releases/download/../evil.exe",
            "https://github.com/corizhang/OnlyPing/releases/download/v1/a.exe?x=1",
            "https://example.com/a.exe",
        ] {
            assert!(!allowed_package(url));
        }
    }
    #[test]
    fn native_update_operations_are_serial_and_unlock_after_failure() {
        let state = UpdateState::default();
        let guard = enter(&state).unwrap();
        assert!(enter(&state).is_err());
        drop(guard);
        assert!(enter(&state).is_ok());
    }
}

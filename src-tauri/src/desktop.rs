use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::Path,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Emitter, Manager};

#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum CloseBehavior {
    #[default]
    Ask,
    Tray,
    Exit,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    #[serde(default)]
    close_behavior: CloseBehavior,
    #[serde(default)]
    minimize_to_tray: bool,
    #[serde(default = "enabled_default")]
    remember_window: bool,
    #[serde(default = "enabled_default")]
    auto_check_updates: bool,
}

fn enabled_default() -> bool {
    true
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            close_behavior: CloseBehavior::Ask,
            minimize_to_tray: false,
            remember_window: true,
            auto_check_updates: true,
        }
    }
}

#[derive(Default)]
pub struct DesktopState {
    preferences: Mutex<Preferences>,
    tray_ready: AtomicBool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopInfo {
    preferences: Preferences,
    tray_available: bool,
}

fn write_preferences(path: &Path, preferences: &Preferences) -> Result<(), String> {
    write_json(path, preferences)
}

pub(super) fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("设置目录无效")?;
    std::fs::create_dir_all(parent).map_err(|_| "无法创建设置目录")?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法写入设置")?;
    file.write_all(&serde_json::to_vec(value).map_err(|_| "设置格式无效")?)
        .map_err(|_| "无法写入设置")?;
    file.as_file().sync_all().map_err(|_| "无法保存设置")?;
    file.persist(path).map_err(|_| "无法替换设置文件")?;
    Ok(())
}

pub fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        super::window_memory::recover_if_offscreen(&window);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn setup(app: &mut tauri::App) {
    let state = app.state::<DesktopState>();
    if let Ok(path) = app
        .path()
        .app_config_dir()
        .map(|p| p.join("desktop-preferences.json"))
    {
        match std::fs::read(&path) {
            Ok(bytes) => match serde_json::from_slice::<Preferences>(&bytes) {
                Ok(value) => *state.preferences.lock().unwrap() = value,
                Err(error) => log::warn!("桌面设置损坏，使用安全默认值: {error}"),
            },
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
                log::warn!("无法读取桌面设置: {error}")
            }
            _ => {}
        }
    }
    let remember = state
        .preferences
        .lock()
        .map(|p| p.remember_window)
        .unwrap_or(true);
    super::window_memory::setup(app, remember);
    match create_tray(app) {
        Ok(()) => state.tray_ready.store(true, Ordering::Release),
        Err(error) => log::warn!("托盘不可用，保留正常窗口退出行为: {error}"),
    }
}

fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let open = MenuItem::with_id(app, "open", "打开 OnlyPing", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, "exit", "退出 OnlyPing", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &settings, &separator, &exit])?;
    let icon = app
        .default_window_icon()
        .ok_or_else(|| tauri::Error::AssetNotFound("tray icon".into()))?
        .clone();
    TrayIconBuilder::with_id("onlyping")
        .icon(icon)
        .tooltip("OnlyPing 明白纸工作台")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show(app),
            "settings" => {
                show(app);
                let _ = app.emit_to("main", "onlyping-settings", ());
            }
            "exit" => {
                show(app);
                let _ = app.emit_to("main", "onlyping-close", "exit");
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

pub fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != "main" {
        return;
    }
    if matches!(
        event,
        tauri::WindowEvent::Moved(_)
            | tauri::WindowEvent::Resized(_)
            | tauri::WindowEvent::ScaleFactorChanged { .. }
            | tauri::WindowEvent::Focused(true)
    ) {
        super::window_memory::capture(window);
    }
    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window.emit("onlyping-close", "close");
        }
        tauri::WindowEvent::Resized(_) => {
            let state = window.state::<DesktopState>();
            if state.tray_ready.load(Ordering::Acquire)
                && state
                    .preferences
                    .lock()
                    .map(|p| p.minimize_to_tray)
                    .unwrap_or(false)
                && window.is_minimized().unwrap_or(false)
            {
                // Route through the same input settlement / recovery-save guard as close-to-tray.
                let _ = window.emit("onlyping-close", "minimize");
            }
        }
        _ => {}
    }
}

#[tauri::command]
pub fn desktop_preferences(state: tauri::State<DesktopState>) -> Result<DesktopInfo, String> {
    Ok(DesktopInfo {
        preferences: state
            .preferences
            .lock()
            .map_err(|_| "无法读取桌面设置")?
            .clone(),
        tray_available: state.tray_ready.load(Ordering::Acquire),
    })
}

#[tauri::command]
pub fn desktop_save_preferences(
    app: tauri::AppHandle,
    state: tauri::State<DesktopState>,
    preferences: Preferences,
) -> Result<(), String> {
    let mut current = state.preferences.lock().map_err(|_| "无法保存桌面设置")?;
    let path = app
        .path()
        .app_config_dir()
        .map_err(|_| "设置目录不可用")?
        .join("desktop-preferences.json");
    write_preferences(&path, &preferences)?;
    let remember = preferences.remember_window;
    *current = preferences;
    drop(current);
    super::window_memory::set_enabled(&app, remember);
    Ok(())
}

#[tauri::command]
pub fn desktop_close_action(
    app: tauri::AppHandle,
    state: tauri::State<DesktopState>,
    action: String,
) -> Result<(), String> {
    match action.as_str() {
        "hide" if state.tray_ready.load(Ordering::Acquire) => app
            .get_webview_window("main")
            .ok_or("窗口不存在")?
            .hide()
            .map_err(|_| "无法隐藏窗口".into()),
        "hide" => Err("系统托盘不可用，请正常退出应用".into()),
        "restore" => {
            show(&app);
            Ok(())
        }
        "exit" => {
            super::window_memory::flush(&app);
            app.exit(0);
            Ok(())
        }
        _ => Err("无效的窗口操作".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_invalid_settings_are_safe() {
        let legacy = serde_json::from_str::<Preferences>(
            r#"{"closeBehavior":"tray","minimizeToTray":true}"#,
        )
        .unwrap();
        assert!(legacy.remember_window);
        assert_eq!(legacy.close_behavior, CloseBehavior::Tray);
        assert_eq!(
            serde_json::from_str::<Preferences>("{}").unwrap(),
            Preferences::default()
        );
        assert!(serde_json::from_str::<Preferences>(r#"{"closeBehavior":"silent"}"#).is_err());
        assert!(serde_json::from_str::<Preferences>(r#"{"minimizeToTray":"true"}"#).is_err());
        assert!(serde_json::from_str::<Preferences>(r#"{"unknown":1}"#).is_err());
    }
    #[test]
    fn atomic_settings_replace_and_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/settings.json");
        write_preferences(&path, &Preferences::default()).unwrap();
        let preferences = Preferences {
            close_behavior: CloseBehavior::Tray,
            minimize_to_tray: true,
            remember_window: true,
            auto_check_updates: true,
        };
        write_preferences(&path, &preferences).unwrap();
        assert_eq!(
            serde_json::from_slice::<Preferences>(&std::fs::read(&path).unwrap()).unwrap(),
            preferences
        );
        assert_eq!(
            std::fs::read_dir(path.parent().unwrap()).unwrap().count(),
            1
        );
    }
    #[test]
    fn failed_replace_keeps_destination_and_cleans_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("occupied");
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("sentinel"), "keep").unwrap();
        assert!(write_preferences(&path, &Preferences::default()).is_err());
        assert_eq!(
            std::fs::read_to_string(path.join("sentinel")).unwrap(),
            "keep"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}

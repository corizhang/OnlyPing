//! Window preferences only: never stores project content, hidden/minimized state or credentials.
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        Mutex, OnceLock,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::Duration,
};
use tauri::Manager;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    version: u8,
    x: i32,
    y: i32,
    width: f64,
    height: f64,
    scale: f64,
    monitor: Option<String>,
    monitor_x: i32,
    monitor_y: i32,
    maximized: bool,
}
#[derive(Clone, Debug)]
struct Screen {
    name: Option<String>,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
}
#[derive(Debug)]
struct Plan {
    x: i32,
    y: i32,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
    maximized: bool,
    screen: Screen,
}

fn valid(s: &Snapshot) -> bool {
    s.version == 1
        && s.width.is_finite()
        && s.height.is_finite()
        && s.scale.is_finite()
        && (200.0..=16384.0).contains(&s.width)
        && (150.0..=16384.0).contains(&s.height)
        && (0.25..=8.0).contains(&s.scale)
        && s.monitor.as_ref().is_none_or(|v| v.len() <= 256)
}
fn plan(saved: Option<&Snapshot>, screens: &[Screen], frame: (f64, f64)) -> Option<Plan> {
    let screens: Vec<_> = screens
        .iter()
        .filter(|m| {
            m.width > 100
                && m.height > 100
                && m.scale.is_finite()
                && (0.25..=8.0).contains(&m.scale)
        })
        .collect();
    let saved = saved.filter(|s| valid(s));
    let preferred = saved.and_then(|s| s.monitor.as_ref()).and_then(|name| {
        screens
            .iter()
            .copied()
            .find(|m| m.name.as_ref() == Some(name))
    });
    let screen = preferred
        .or_else(|| {
            saved.and_then(|s| {
                screens
                    .iter()
                    .copied()
                    .max_by_key(|m| {
                        let w = (i64::from(m.x) + i64::from(m.width))
                            .min(i64::from(s.x) + (s.width * s.scale) as i64)
                            - i64::from(m.x.max(s.x));
                        let h = (i64::from(m.y) + i64::from(m.height))
                            .min(i64::from(s.y) + (s.height * s.scale) as i64)
                            - i64::from(m.y.max(s.y));
                        w.max(0) * h.max(0)
                    })
                    .filter(|m| {
                        f64::from(s.x) < f64::from(m.x) + f64::from(m.width)
                            && f64::from(s.y) < f64::from(m.y) + f64::from(m.height)
                            && f64::from(s.x) + s.width * s.scale > f64::from(m.x)
                            && f64::from(s.y) + s.height * s.scale > f64::from(m.y)
                    })
            })
        })
        .or_else(|| screens.first().copied())?;
    let frame_w = frame.0.clamp(0.0, 100.0);
    let frame_h = frame.1.clamp(0.0, 160.0);
    let max_width = (f64::from(screen.width) / screen.scale - frame_w).max(100.0);
    let max_height = (f64::from(screen.height) / screen.scale - frame_h).max(100.0);
    let min_width = 1000.0_f64.min(max_width);
    let min_height = 700.0_f64.min(max_height);
    let width = saved
        .map_or(1440.0, |s| s.width)
        .clamp(min_width, max_width);
    let height = saved
        .map_or(960.0, |s| s.height)
        .clamp(min_height, max_height);
    let outer_w = (width + frame_w) * screen.scale;
    let outer_h = (height + frame_h) * screen.scale;
    let x = saved.map_or(
        f64::from(screen.x) + (f64::from(screen.width) - outer_w) / 2.0,
        |s| {
            f64::from(screen.x) + (f64::from(s.x) - f64::from(s.monitor_x)) / s.scale * screen.scale
        },
    );
    let y = saved.map_or(
        f64::from(screen.y) + (f64::from(screen.height) - outer_h) / 2.0,
        |s| {
            f64::from(screen.y) + (f64::from(s.y) - f64::from(s.monitor_y)) / s.scale * screen.scale
        },
    );
    Some(Plan {
        x: x.clamp(
            f64::from(screen.x),
            f64::from(screen.x) + (f64::from(screen.width) - outer_w).max(0.0),
        )
        .round() as i32,
        y: y.clamp(
            f64::from(screen.y),
            f64::from(screen.y) + (f64::from(screen.height) - outer_h).max(0.0),
        )
        .round() as i32,
        width,
        height,
        min_width,
        min_height,
        maximized: saved.is_some_and(|s| s.maximized),
        screen: screen.clone(),
    })
}

enum Save {
    Update(Snapshot),
    Flush(mpsc::Sender<()>),
}
pub struct WindowMemory {
    enabled: AtomicBool,
    ready: AtomicBool,
    latest: Mutex<Option<Snapshot>>,
    writer: OnceLock<mpsc::Sender<Save>>,
}
impl Default for WindowMemory {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(true),
            ready: AtomicBool::new(false),
            latest: Mutex::new(None),
            writer: OnceLock::new(),
        }
    }
}
fn write_pending(path: &std::path::Path, pending: &mut Option<Snapshot>) {
    if let Some(value) = pending.take() {
        if let Err(error) = super::desktop::write_json(path, &value) {
            log::warn!("窗口布局保存失败: {error}");
        }
    }
}
fn writer(path: PathBuf, receiver: mpsc::Receiver<Save>) {
    let mut pending = None;
    loop {
        let next = if pending.is_some() {
            receiver.recv_timeout(Duration::from_millis(700))
        } else {
            receiver
                .recv()
                .map_err(|_| mpsc::RecvTimeoutError::Disconnected)
        };
        match next {
            Ok(Save::Update(value)) => pending = Some(value),
            Ok(Save::Flush(done)) => {
                write_pending(&path, &mut pending);
                let _ = done.send(());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => write_pending(&path, &mut pending),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                write_pending(&path, &mut pending);
                break;
            }
        }
    }
}
pub fn setup(app: &tauri::App, enabled: bool) {
    let state = app.state::<WindowMemory>();
    state.enabled.store(enabled, Ordering::Release);
    let path = app
        .path()
        .app_config_dir()
        .map(|p| p.join("window-layout.json"));
    if let Ok(path) = path {
        if enabled && std::fs::metadata(&path).is_ok_and(|m| m.len() <= 8192) {
            match std::fs::read(&path)
                .ok()
                .and_then(|bytes| serde_json::from_slice::<Snapshot>(&bytes).ok())
                .filter(valid)
            {
                Some(value) => *state.latest.lock().unwrap() = Some(value),
                None => log::warn!("窗口布局无效，使用默认位置"),
            }
        }
        let (sender, receiver) = mpsc::channel();
        if std::thread::Builder::new()
            .name("window-layout".into())
            .spawn(move || writer(path, receiver))
            .is_ok()
        {
            let _ = state.writer.set(sender);
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        if let Err(error) = restore(&window, &state) {
            log::warn!("窗口布局恢复失败: {error}");
        }
        state.ready.store(true, Ordering::Release);
        capture(&window.as_ref().window());
    }
}
fn restore(window: &tauri::WebviewWindow, state: &WindowMemory) -> tauri::Result<()> {
    let mut monitors = window.available_monitors()?;
    let primary = window.primary_monitor()?;
    if let Some(index) = monitors.iter().position(|m| {
        primary
            .as_ref()
            .is_some_and(|p| p.position() == m.position())
    }) {
        monitors.swap(0, index);
    }
    let screens = monitors
        .iter()
        .map(|m| {
            let area = m.work_area();
            Screen {
                name: m.name().cloned(),
                x: area.position.x,
                y: area.position.y,
                width: area.size.width,
                height: area.size.height,
                scale: m.scale_factor(),
            }
        })
        .collect::<Vec<_>>();
    let scale = window.scale_factor()?;
    let inner = window.inner_size()?;
    let outer = window.outer_size()?;
    let frame = (
        f64::from(outer.width.saturating_sub(inner.width)) / scale,
        f64::from(outer.height.saturating_sub(inner.height)) / scale,
    );
    let saved = state.latest.lock().unwrap().clone();
    if let Some(plan) = plan(saved.as_ref(), &screens, frame) {
        if window.is_maximized()? {
            window.unmaximize()?;
        }
        window.set_min_size(Some(tauri::LogicalSize::new(
            plan.min_width,
            plan.min_height,
        )))?;
        window.set_size(tauri::LogicalSize::new(plan.width, plan.height))?;
        window.set_position(tauri::PhysicalPosition::new(plan.x, plan.y))?;
        // Preserve restored normal bounds even if the first observed event is maximized.
        *state.latest.lock().unwrap() = Some(Snapshot {
            version: 1,
            x: plan.x,
            y: plan.y,
            width: plan.width,
            height: plan.height,
            scale: plan.screen.scale,
            monitor: plan.screen.name,
            monitor_x: plan.screen.x,
            monitor_y: plan.screen.y,
            maximized: plan.maximized,
        });
        if plan.maximized {
            window.maximize()?;
        }
    }
    Ok(())
}
pub fn capture<R: tauri::Runtime>(window: &tauri::Window<R>) {
    let state = window.state::<WindowMemory>();
    if !state.ready.load(Ordering::Acquire)
        || window.is_minimized().unwrap_or(true)
        || !window.is_visible().unwrap_or(false)
        || window.is_fullscreen().unwrap_or(true)
    {
        return;
    }
    let Ok(maximized) = window.is_maximized() else {
        return;
    };
    let Ok(mut latest) = state.latest.lock() else {
        return;
    };
    if maximized {
        if let Some(value) = latest.as_mut() {
            value.maximized = true;
        }
    } else if let (Ok(position), Ok(size), Ok(scale), Ok(Some(monitor))) = (
        window.outer_position(),
        window.inner_size(),
        window.scale_factor(),
        window.current_monitor(),
    ) {
        let value = Snapshot {
            version: 1,
            x: position.x,
            y: position.y,
            width: f64::from(size.width) / scale,
            height: f64::from(size.height) / scale,
            scale,
            monitor: monitor.name().cloned(),
            monitor_x: monitor.work_area().position.x,
            monitor_y: monitor.work_area().position.y,
            maximized: false,
        };
        if valid(&value) {
            *latest = Some(value);
        }
    }
    if state.enabled.load(Ordering::Acquire) {
        if let (Some(value), Some(writer)) = (latest.clone(), state.writer.get()) {
            let _ = writer.send(Save::Update(value));
        }
    }
}
pub fn recover_if_offscreen(window: &tauri::WebviewWindow) {
    let (Ok(position), Ok(size), Ok(monitors)) = (
        window.outer_position(),
        window.outer_size(),
        window.available_monitors(),
    ) else {
        return;
    };
    // Maximized Windows frames extend a few pixels beyond the monitor work area.
    if window.is_maximized().unwrap_or(false)
        && monitors.iter().any(|m| {
            let a = m.work_area();
            i64::from(position.x) < i64::from(a.position.x) + i64::from(a.size.width)
                && i64::from(position.y) < i64::from(a.position.y) + i64::from(a.size.height)
                && i64::from(position.x) + i64::from(size.width) > i64::from(a.position.x)
                && i64::from(position.y) + i64::from(size.height) > i64::from(a.position.y)
        })
    {
        return;
    }
    let title_visible = monitors.iter().any(|m| {
        let area = m.work_area();
        let left = i64::from(position.x).max(i64::from(area.position.x));
        let right = (i64::from(position.x) + i64::from(size.width))
            .min(i64::from(area.position.x) + i64::from(area.size.width));
        right - left >= 160
            && i64::from(position.y) >= i64::from(area.position.y)
            && i64::from(position.y) + 30
                <= i64::from(area.position.y) + i64::from(area.size.height)
    });
    if !title_visible {
        if let Err(error) = restore(window, &window.state::<WindowMemory>()) {
            log::warn!("窗口移回可见区域失败: {error}");
        }
    }
}
pub fn set_enabled(app: &tauri::AppHandle, enabled: bool) {
    app.state::<WindowMemory>()
        .enabled
        .store(enabled, Ordering::Release);
    if enabled {
        if let Some(window) = app.get_webview_window("main") {
            capture(&window.as_ref().window());
        }
    }
}
pub fn flush(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        capture(&window.as_ref().window());
    }
    if let Some(writer) = app.state::<WindowMemory>().writer.get() {
        let (done, wait) = mpsc::channel();
        if writer.send(Save::Flush(done)).is_ok() {
            let _ = wait.recv_timeout(Duration::from_secs(2));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn screen(name: &str, x: i32, scale: f64) -> Screen {
        Screen {
            name: Some(name.into()),
            x,
            y: 0,
            width: 1920,
            height: 1040,
            scale,
        }
    }
    fn saved() -> Snapshot {
        Snapshot {
            version: 1,
            x: 2080,
            y: 80,
            width: 1200.0,
            height: 800.0,
            scale: 1.0,
            monitor: Some("secondary".into()),
            monitor_x: 1920,
            monitor_y: 0,
            maximized: true,
        }
    }
    #[test]
    fn unplugged_screen_restores_on_primary_with_titlebar_in_work_area() {
        let p = plan(Some(&saved()), &[screen("primary", 0, 1.0)], (16.0, 39.0)).unwrap();
        assert_eq!((p.x, p.y), (160, 80));
        assert!(p.maximized);
        assert!(p.x as f64 + p.width + 16.0 <= 1920.0);
    }
    #[test]
    fn dpi_change_keeps_logical_size_and_scales_monitor_relative_offset() {
        let p = plan(
            Some(&saved()),
            &[screen("secondary", -1920, 1.25)],
            (16.0, 39.0),
        )
        .unwrap();
        assert_eq!((p.x, p.y), (-1720, 0));
        assert_eq!(p.width, 1200.0);
        assert_eq!(p.height, 793.0);
    }
    #[test]
    fn tiny_work_area_and_corrupt_snapshots_never_put_titlebar_off_screen() {
        let monitor = Screen {
            width: 1280,
            height: 680,
            ..screen("primary", 0, 1.5)
        };
        let mut s = saved();
        s.width = f64::INFINITY;
        let p = plan(Some(&s), &[monitor], (16.0, 39.0)).unwrap();
        assert!(!p.maximized);
        assert_eq!((p.x, p.y), (0, 0));
        assert!(p.width < 1000.0);
        assert!(p.height < 700.0);
        assert!(plan(None, &[], (0.0, 0.0)).is_none());
        s = saved();
        s.version = 2;
        assert!(!valid(&s));
        s = saved();
        s.scale = 0.0;
        assert!(!valid(&s));
    }
    #[test]
    fn writer_flushes_latest_snapshot_and_valid_state_survives_reopen() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("layout.json");
        let (tx, rx) = mpsc::channel();
        let target = path.clone();
        let worker = std::thread::spawn(move || writer(target, rx));
        let mut final_value = saved();
        tx.send(Save::Update(final_value.clone())).unwrap();
        final_value.width = 1300.0;
        tx.send(Save::Update(final_value.clone())).unwrap();
        let (done, wait) = mpsc::channel();
        tx.send(Save::Flush(done)).unwrap();
        wait.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(
            serde_json::from_slice::<Snapshot>(&std::fs::read(&path).unwrap()).unwrap(),
            final_value
        );
        drop(tx);
        worker.join().unwrap();
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }
}

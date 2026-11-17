use std::{
    collections::HashSet,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri_plugin_fs::FsExt;

const LIMIT: usize = 200 * 1024 * 1024;
struct Session {
    path: PathBuf,
    names: Vec<String>,
    next: usize,
    bytes: usize,
}
#[derive(Clone, Default)]
pub struct ImageExportState {
    session: Arc<Mutex<Option<Session>>>,
    locations: Arc<Mutex<Vec<Location>>>,
}
struct Location {
    id: String,
    path: PathBuf,
    canonical: PathBuf,
}
#[derive(serde::Serialize)]
pub struct Destination {
    id: String,
    path: String,
}
fn remember(state: &ImageExportState, id: String, path: PathBuf) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&path).map_err(|_| "无法记录导出目录")?;
    let mut locations = state.locations.lock().map_err(|_| "导出目录状态不可用")?;
    locations.retain(|entry| entry.id != id);
    locations.push(Location {
        id,
        path,
        canonical,
    });
    if locations.len() > 20 {
        locations.remove(0);
    }
    Ok(())
}
fn recorded_location(state: &ImageExportState, id: &str) -> Result<PathBuf, String> {
    let locations = state.locations.lock().map_err(|_| "导出目录状态不可用")?;
    let entry = locations
        .iter()
        .find(|entry| entry.id == id)
        .ok_or("此导出位置已失效，请根据显示的路径手动查看")?;
    let metadata = std::fs::symlink_metadata(&entry.path).map_err(|_| "导出目录已被删除或移动")?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || std::fs::canonicalize(&entry.path).map_err(|_| "无法访问导出目录")? != entry.canonical
    {
        return Err("导出目录已被替换，请手动检查路径".into());
    }
    Ok(entry.path.clone())
}
#[tauri::command]
pub async fn image_export_file_location(
    app: tauri::AppHandle,
    state: tauri::State<'_, ImageExportState>,
    path: String,
) -> Result<Destination, String> {
    use sha2::{Digest, Sha256};
    let file = PathBuf::from(&path);
    if !file.is_absolute() || !app.fs_scope().is_allowed(&file) || !file.is_file() {
        return Err("此文件未通过保存选择器授权".into());
    }
    let parent = file.parent().ok_or("文件目录无效")?.to_path_buf();
    let id = format!("file-{:x}", Sha256::digest(path.as_bytes()));
    remember(&state, id.clone(), parent.clone())?;
    Ok(Destination {
        id,
        path: parent.to_string_lossy().into_owned(),
    })
}
#[tauri::command]
pub async fn image_export_open_location(
    state: tauri::State<'_, ImageExportState>,
    id: String,
) -> Result<(), String> {
    let path = recorded_location(&state, &id)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(path)
            .spawn()
            .map_err(|_| "无法打开资源管理器，请手动查看路径")?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("当前平台请根据显示的路径手动打开目录".into())
    }
}
fn create(parent: &Path, names: Vec<String>) -> Result<Session, String> {
    if names.is_empty() || names.len() > 1000 {
        return Err("每批请选择 1–1000 张图片".into());
    }
    let mut unique = HashSet::new();
    for name in &names {
        if name.len() > 400
            || !(name.ends_with(".png") || name.ends_with(".jpg"))
            || name
                .chars()
                .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
            || !name.as_bytes().first().is_some_and(u8::is_ascii_digit)
            || !unique.insert(name.to_lowercase())
        {
            return Err("导出文件名无效或重复".into());
        }
    }
    let path = tempfile::Builder::new()
        .prefix("OnlyPing-images-")
        .tempdir_in(parent)
        .map_err(|_| "无法创建导出子目录，请检查磁盘空间及目录权限")?
        .keep();
    Ok(Session {
        path,
        names,
        next: 0,
        bytes: 0,
    })
}
fn write(session: &mut Session, index: usize, bytes: &[u8]) -> Result<(), String> {
    if index != session.next || index >= session.names.len() {
        return Err("导出顺序无效，请重新导出".into());
    }
    let valid = if session.names[index].ends_with(".jpg") {
        bytes.starts_with(b"\xff\xd8\xff") && bytes.ends_with(b"\xff\xd9")
    } else {
        bytes.starts_with(b"\x89PNG\r\n\x1a\n")
    };
    if !valid || bytes.len() > LIMIT - session.bytes {
        return Err("图片格式与文件名不符或本批超过 200 MiB".into());
    }
    if !std::fs::symlink_metadata(&session.path)
        .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
    {
        return Err("导出目录已被移动或替换".into());
    }
    let mut file = tempfile::Builder::new()
        .prefix(".onlyping-")
        .tempfile_in(&session.path)
        .map_err(|_| "无法创建临时图片")?;
    file.write_all(bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| "图片写入失败，请检查磁盘空间和权限")?;
    file.persist_noclobber(session.path.join(&session.names[index]))
        .map_err(|_| "图片提交失败：文件已存在、被占用或目录不可写；未覆盖已有文件")?;
    session.next += 1;
    session.bytes += bytes.len();
    Ok(())
}
#[tauri::command]
pub async fn image_export_begin(
    app: tauri::AppHandle,
    state: tauri::State<'_, ImageExportState>,
    parent: String,
    names: Vec<String>,
) -> Result<Destination, String> {
    let parent = PathBuf::from(parent);
    if !parent.is_absolute() || !app.fs_scope().is_allowed(&parent) {
        return Err("请通过文件夹对话框选择导出位置".into());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = state.session.lock().map_err(|_| "导出状态不可用")?;
        if slot.is_some() {
            return Err("已有文件夹导出正在进行".into());
        }
        let session = create(&parent, names)?;
        let destination = Destination {
            id: session
                .path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            path: session.path.to_string_lossy().into_owned(),
        };
        remember(&state, destination.id.clone(), session.path.clone())?;
        *slot = Some(session);
        Ok(destination)
    })
    .await
    .map_err(|_| "创建导出目录失败")?
}
#[tauri::command]
pub async fn image_export_write(
    state: tauri::State<'_, ImageExportState>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let id = request
        .headers()
        .get("x-onlyping-session")
        .and_then(|v| v.to_str().ok())
        .ok_or("缺少导出会话")?
        .to_owned();
    let index: usize = request
        .headers()
        .get("x-onlyping-index")
        .and_then(|v| v.to_str().ok())
        .ok_or("缺少图片序号")?
        .parse()
        .map_err(|_| "图片序号无效")?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if bytes.len() <= LIMIT => bytes.clone(),
        _ => return Err("仅支持二进制图片数据".into()),
    };
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = state.session.lock().map_err(|_| "导出状态不可用")?;
        let session = slot.as_mut().ok_or("导出会话已结束")?;
        if session.path.file_name().and_then(|v| v.to_str()) != Some(id.as_str()) {
            return Err("导出会话不匹配".into());
        }
        write(session, index, &bytes)
    })
    .await
    .map_err(|_| "图片写入任务失败")?
}
#[tauri::command]
pub async fn image_export_end(
    state: tauri::State<'_, ImageExportState>,
    id: String,
) -> Result<(), String> {
    let mut slot = state.session.lock().map_err(|_| "导出状态不可用")?;
    if slot.as_ref().is_some_and(|session| {
        session.path.file_name().and_then(|v| v.to_str()) == Some(id.as_str())
    }) {
        *slot = None;
        Ok(())
    } else {
        Err("导出会话不匹配".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nsynthetic";
    #[test]
    fn locations_are_session_scoped_bounded_and_reject_missing_directories() {
        let root = tempfile::tempdir().unwrap();
        let state = ImageExportState::default();
        assert!(recorded_location(&state, root.path().to_str().unwrap()).is_err());
        for i in 0..21 {
            remember(&state, i.to_string(), root.path().to_path_buf()).unwrap();
        }
        assert!(recorded_location(&state, "0").is_err());
        assert_eq!(recorded_location(&state, "20").unwrap(), root.path());
        assert!(recorded_location(&ImageExportState::default(), "20").is_err());
        let path = root.path().join("removed");
        std::fs::create_dir(&path).unwrap();
        remember(&state, "gone".into(), path.clone()).unwrap();
        std::fs::remove_dir(path).unwrap();
        assert!(recorded_location(&state, "gone").is_err());
    }
    #[test]
    fn jpeg_format_must_match_extension() {
        let root = tempfile::tempdir().unwrap();
        let mut session = create(
            root.path(),
            vec!["001-照片.jpg".into(), "002-image.png".into()],
        )
        .unwrap();
        const JPEG: &[u8] = b"\xff\xd8\xffsynthetic\xff\xd9";
        assert!(write(&mut session, 0, PNG).is_err());
        assert!(write(&mut session, 0, b"\xff\xd8\xfftruncated").is_err());
        write(&mut session, 0, JPEG).unwrap();
        assert_eq!(
            std::fs::read(session.path.join("001-照片.jpg")).unwrap(),
            JPEG
        );
        assert!(write(&mut session, 1, JPEG).is_err());
        write(&mut session, 1, PNG).unwrap();
    }
    #[test]
    fn unique_folders_order_and_no_clobber() {
        let root = tempfile::tempdir().unwrap();
        let names = vec!["001-中文.png".into(), "002-image.png".into()];
        let mut a = create(root.path(), names.clone()).unwrap();
        let b = create(root.path(), names).unwrap();
        assert_ne!(a.path, b.path);
        assert!(write(&mut a, 1, PNG).is_err());
        write(&mut a, 0, PNG).unwrap();
        assert_eq!(std::fs::read(a.path.join("001-中文.png")).unwrap(), PNG);
        std::fs::write(a.path.join("002-image.png"), b"existing").unwrap();
        assert!(write(&mut a, 1, PNG).is_err());
        assert_eq!(a.next, 1);
        assert_eq!(
            std::fs::read(a.path.join("002-image.png")).unwrap(),
            b"existing"
        );
        assert_eq!(std::fs::read_dir(&a.path).unwrap().count(), 2);
    }
    #[test]
    fn reject_paths_duplicates_and_invalid_png() {
        let root = tempfile::tempdir().unwrap();
        for names in [
            vec!["../escape.png".into()],
            vec!["001-A.png".into(), "001-a.png".into()],
            vec!["001-a.png:stream".into()],
        ] {
            assert!(create(root.path(), names).is_err());
        }
        let mut a = create(root.path(), vec!["001-a.png".into()]).unwrap();
        assert!(write(&mut a, 0, b"bad").is_err());
        a.bytes = LIMIT;
        assert!(write(&mut a, 0, PNG).is_err());
        assert_eq!(std::fs::read_dir(a.path).unwrap().count(), 0);
    }
}

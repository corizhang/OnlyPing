use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri_plugin_fs::FsExt;

#[derive(Debug, Serialize)]
pub struct FileError {
    code: &'static str,
    message: &'static str,
}
type Result<T> = std::result::Result<T, FileError>;
fn io_error() -> FileError {
    FileError {
        code: "io",
        message: "项目文件读写失败，请检查磁盘空间、目录权限或文件占用；原文件未被直接截断，请另存为",
    }
}
fn conflict() -> FileError {
    FileError {
        code: "conflict",
        message: "文件已在外部修改、删除或替换，未覆盖磁盘内容。请另存为，或重新打开文件后比较修改",
    }
}
fn checked_path(app: &tauri::AppHandle, path: String) -> Result<PathBuf> {
    let path = PathBuf::from(path);
    if !path.is_absolute() || !app.fs_scope().is_allowed(&path) {
        return Err(FileError {
            code: "scope",
            message: "请先通过文件对话框选择项目文件，重启后需要重新授权",
        });
    }
    Ok(path)
}
fn version(path: &Path) -> Result<Option<String>> {
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(io_error()),
        Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
            return Err(FileError {
                code: "type",
                message: "请选择普通项目文件；目录或符号链接请改用另存为",
            });
        }
        _ => (),
    }
    let mut file = std::fs::File::open(path).map_err(|_| io_error())?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(|_| io_error())?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(Some(format!("{:x}", digest.finalize())))
}
fn write_checked(path: &Path, contents: &str, expected: Option<&str>) -> Result<String> {
    let value: serde_json::Value = serde_json::from_str(contents).map_err(|_| FileError {
        code: "invalid",
        message: "项目 JSON 无效，未写入文件",
    })?;
    if !value.is_object() || !value.get("pages").is_some_and(serde_json::Value::is_array) {
        return Err(FileError {
            code: "invalid",
            message: "项目结构无效，未写入文件",
        });
    }
    if version(path)?.as_deref() != expected {
        return Err(conflict());
    }
    let parent = path.parent().ok_or_else(io_error)?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".onlyping-")
        .suffix(".tmp")
        .tempfile_in(parent)
        .map_err(|_| io_error())?;
    temporary
        .write_all(contents.as_bytes())
        .map_err(|_| io_error())?;
    temporary.as_file().sync_all().map_err(|_| io_error())?;
    // Re-check after staging. This is optimistic detection, not an inter-process transaction.
    if version(path)?.as_deref() != expected {
        return Err(conflict());
    }
    if expected.is_some() {
        temporary.persist(path).map_err(|_| io_error())?;
    } else {
        temporary.persist_noclobber(path).map_err(|_| conflict())?;
    }
    Ok(format!("{:x}", Sha256::digest(contents.as_bytes())))
}

#[tauri::command]
pub async fn project_file_version(app: tauri::AppHandle, path: String) -> Result<Option<String>> {
    let path = checked_path(&app, path)?;
    tauri::async_runtime::spawn_blocking(move || version(&path))
        .await
        .map_err(|_| io_error())?
}
#[tauri::command]
pub async fn project_file_write(
    app: tauri::AppHandle,
    path: String,
    contents: String,
    expected_hash: Option<String>,
) -> Result<String> {
    let path = checked_path(&app, path)?;
    tauri::async_runtime::spawn_blocking(move || {
        write_checked(&path, &contents, expected_hash.as_deref())
    })
    .await
    .map_err(|_| io_error())?
}

#[cfg(test)]
mod tests {
    use super::*;
    const FIRST: &str = "{\"title\":\"中文项目\",\"pages\":[]}";
    const SECOND: &str = "{\"title\":\"第二版\",\"pages\":[]}";
    #[test]
    fn create_replace_and_conflict_preserve_complete_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("中文.json");
        let first = write_checked(&path, FIRST, None).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), FIRST);
        let second = write_checked(&path, SECOND, Some(&first)).unwrap();
        assert_eq!(version(&path).unwrap(), Some(second));
        assert_eq!(
            write_checked(&path, FIRST, Some(&first)).unwrap_err().code,
            "conflict"
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), SECOND);
        assert_eq!(
            write_checked(&path, FIRST, None).unwrap_err().code,
            "conflict"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
    #[test]
    fn invalid_json_deleted_target_and_external_edits_are_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("p.json");
        let first = write_checked(&path, FIRST, None).unwrap();
        assert!(write_checked(&path, "invalid", Some(&first)).is_err());
        assert!(write_checked(&path, "{}", Some(&first)).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), FIRST);
        std::fs::write(&path, "external contents").unwrap();
        assert_eq!(
            write_checked(&path, SECOND, Some(&first)).unwrap_err().code,
            "conflict"
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "external contents");
        std::fs::remove_file(&path).unwrap();
        assert_eq!(
            write_checked(&path, SECOND, Some(&first)).unwrap_err().code,
            "conflict"
        );
        assert!(!path.exists());
    }
    #[test]
    fn invalid_parent_and_directory_never_create_partial_targets() {
        let dir = tempfile::tempdir().unwrap();
        assert!(write_checked(&dir.path().join("missing/p.json"), FIRST, None).is_err());
        assert!(write_checked(dir.path(), FIRST, None).is_err());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
    #[cfg(windows)]
    #[test]
    fn windows_locked_destination_remains_intact_and_retry_succeeds() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("locked.json");
        let first = write_checked(&path, FIRST, None).unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&path)
            .unwrap();
        assert!(write_checked(&path, SECOND, Some(&first)).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), FIRST);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        drop(lock);
        write_checked(&path, SECOND, Some(&first)).unwrap();
    }
}

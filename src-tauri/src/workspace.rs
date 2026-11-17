use crate::project_files::write_checked;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_fs::FsExt;
type Result<T> = std::result::Result<T, String>;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: String,
    path: String,
    hash: String,
    title: String,
    pages: i64,
    saved_at: i64,
    accessed_at: i64,
    thumbnail: Option<String>,
    available: bool,
}
#[derive(Serialize)]
pub struct Info {
    directory: String,
    projects: Vec<Entry>,
}
#[derive(Serialize)]
pub struct Opened {
    entry: Entry,
    contents: String,
    changed: bool,
}
fn err(error: impl std::fmt::Display) -> String {
    format!("项目目录操作失败：{error}。请保留工作区并检查目录权限、磁盘空间或恢复存档")
}
fn connect(path: &Path) -> Result<Connection> {
    let db = Connection::open(path).map_err(err)?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(err)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,path TEXT NOT NULL UNIQUE COLLATE NOCASE,hash TEXT NOT NULL,title TEXT NOT NULL,pages INTEGER NOT NULL,saved_at INTEGER NOT NULL,accessed_at INTEGER NOT NULL,thumbnail TEXT);").map_err(err)?;
    Ok(db)
}
fn db(app: &tauri::AppHandle) -> Result<Connection> {
    let root = app.path().app_local_data_dir().map_err(err)?;
    std::fs::create_dir_all(&root).map_err(err)?;
    connect(&root.join("project-library.sqlite3"))
}
fn row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Entry> {
    let path: String = row.get(1)?;
    let available = std::fs::metadata(&path).is_ok_and(|m| m.is_file());
    Ok(Entry {
        id: row.get(0)?,
        path,
        hash: row.get(2)?,
        title: row.get(3)?,
        pages: row.get(4)?,
        saved_at: row.get(5)?,
        accessed_at: row.get(6)?,
        thumbnail: row.get(7)?,
        available,
    })
}
fn lookup(db: &Connection, id: &str) -> Result<Option<Entry>> {
    db.query_row(
        "SELECT id,path,hash,title,pages,saved_at,accessed_at,thumbnail FROM projects WHERE id=?",
        [id],
        row,
    )
    .optional()
    .map_err(err)
}
fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn data(contents: &str) -> Result<(String, String, i64)> {
    if contents.len() > 512 * 1024 * 1024 {
        return Err("项目超过 512 MiB，请先减少图片或另存备份".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(contents.trim_start_matches('\u{feff}')).map_err(err)?;
    let id = value["projectId"].as_str().ok_or("项目缺少标识")?;
    if id.is_empty()
        || id.len() > 80
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("项目标识无效，未写入文件".into());
    }
    let pages = value["pages"].as_array().ok_or("项目图片列表无效")?.len();
    Ok((
        id.into(),
        value["title"]
            .as_str()
            .unwrap_or("未命名项目")
            .chars()
            .take(200)
            .collect(),
        pages as i64,
    ))
}
fn record(
    db: &Connection,
    path: &Path,
    hash: &str,
    contents: &str,
    thumbnail: Option<String>,
) -> Result<Entry> {
    let (id, title, pages) = data(contents)?;
    let thumbnail =
        thumbnail.filter(|v| v.len() <= 100_000 && v.starts_with("data:image/jpeg;base64,"));
    db.execute("INSERT INTO projects(id,path,hash,title,pages,saved_at,accessed_at,thumbnail) VALUES(?1,?2,?3,?4,?5,?6,?6,?7) ON CONFLICT(id) DO UPDATE SET path=excluded.path,hash=excluded.hash,title=excluded.title,pages=excluded.pages,saved_at=excluded.saved_at,accessed_at=excluded.accessed_at,thumbnail=COALESCE(excluded.thumbnail,projects.thumbnail)", params![id, path.to_string_lossy(), hash, title, pages, now(), thumbnail]).map_err(err)?;
    lookup(db, &id)?.ok_or("项目索引记录失败".into())
}
fn directory(app: &tauri::AppHandle, db: &Connection) -> Result<PathBuf> {
    let chosen: Option<String> = db
        .query_row(
            "SELECT value FROM settings WHERE key='directory'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let path = match chosen {
        Some(path) => PathBuf::from(path),
        None if app.config().identifier == "io.github.corizhang.onlyping.qa" => app
            .path()
            .app_local_data_dir()
            .map_err(err)?
            .join("qa-projects"),
        None => app
            .path()
            .document_dir()
            .map_err(err)?
            .join("OnlyPing")
            .join("Projects"),
    };
    if !path.is_absolute() {
        return Err("默认项目目录无效，请重新设置".into());
    }
    Ok(path)
}
pub fn known_path(app: &tauri::AppHandle, path: &Path) -> bool {
    db(app)
        .and_then(|db| {
            db.query_row(
                "SELECT EXISTS(SELECT 1 FROM projects WHERE path=? COLLATE NOCASE)",
                [path.to_string_lossy()],
                |r| r.get::<_, bool>(0),
            )
            .map_err(err)
        })
        .unwrap_or(false)
}
pub fn path_identity_allowed(app: &tauri::AppHandle, path: &Path, contents: &str) -> bool {
    let Ok((id, _, _)) = data(contents) else {
        return false;
    };
    db(app)
        .and_then(|db| {
            db.query_row(
                "SELECT id FROM projects WHERE path=? COLLATE NOCASE",
                [path.to_string_lossy()],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(err)
        })
        .is_ok_and(|owner| owner.is_none_or(|owner| owner == id))
}
fn read_snapshot(path: &Path) -> Result<(String, String)> {
    use sha2::{Digest, Sha256};
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|_| "项目文件已被移动或删除，请重新定位文件或打开本机恢复存档")?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > 512 * 1024 * 1024
    {
        return Err("请选择不超过 512 MiB 的普通项目文件".into());
    }
    let bytes = std::fs::read(path).map_err(err)?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    Ok((String::from_utf8(bytes).map_err(err)?, hash))
}
fn save(
    db: &mut Connection,
    root: &Path,
    contents: &str,
    thumbnail: Option<String>,
) -> Result<Entry> {
    let (id, title, _) = data(contents)?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    let bound = lookup(&tx, &id)?;
    let path = if let Some(entry) = &bound {
        PathBuf::from(&entry.path)
    } else {
        std::fs::create_dir_all(root).map_err(err)?;
        let clean: String = title
            .chars()
            .take(40)
            .map(|c| {
                if c.is_control() || "<>:\"/\\|?*".contains(c) {
                    '_'
                } else {
                    c
                }
            })
            .collect();
        let mut stem = clean.trim().trim_end_matches(['.', ' ']).to_string();
        if stem.is_empty() {
            stem = "未命名项目".into();
        }
        let device = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
        if ["CON", "PRN", "AUX", "NUL"].contains(&device.as_str())
            || (device.len() == 4
                && (device.starts_with("COM") || device.starts_with("LPT"))
                && matches!(device.as_bytes()[3], b'1'..=b'9'))
        {
            stem.insert(0, '_');
        }
        let mut target = root.join(format!("{stem}.json"));
        for index in 2..1001 {
            if !target.try_exists().map_err(err)? {
                break;
            }
            target = root.join(format!("{stem} ({index}).json"));
        }
        if target.try_exists().map_err(err)? {
            return Err("同名文件过多，请更改项目名称或目录".into());
        }
        target
    };
    let hash = write_checked(&path, contents, bound.as_ref().map(|e| e.hash.as_str()))
        .map_err(|e| e.message.to_string())?;
    let entry = record(&tx, &path, &hash, contents, thumbnail)
        .map_err(|e| format!("文件已写入 {}，但索引更新失败：{e}", path.display()))?;
    tx.commit()
        .map_err(|e| format!("文件已写入 {}，但索引提交失败：{e}", path.display()))?;
    Ok(entry)
}
#[tauri::command]
pub async fn workspace_info(app: tauri::AppHandle) -> Result<Info> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = db(&app)?; let directory = directory(&app, &db)?.to_string_lossy().into_owned();
        let mut statement = db.prepare("SELECT id,path,hash,title,pages,saved_at,accessed_at,thumbnail FROM projects ORDER BY accessed_at DESC LIMIT 12").map_err(err)?;
        let projects = statement.query_map([], row).map_err(err)?.collect::<std::result::Result<Vec<_>, _>>().map_err(err)?;
        Ok(Info { directory, projects })
    }).await.map_err(err)?
}
#[tauri::command]
pub async fn workspace_directory(app: tauri::AppHandle, path: String) -> Result<()> {
    let root = PathBuf::from(path);
    if !root.is_absolute() || !root.is_dir() || !app.fs_scope().is_allowed(&root) {
        return Err("请通过文件夹选择器设置项目目录".into());
    }
    tauri::async_runtime::spawn_blocking(move || { db(&app)?.execute("INSERT INTO settings(key,value) VALUES('directory',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [root.to_string_lossy()]).map_err(err)?; Ok(()) }).await.map_err(err)?
}
#[tauri::command]
pub async fn workspace_save(
    app: tauri::AppHandle,
    contents: String,
    thumbnail: Option<String>,
) -> Result<Entry> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut db = db(&app)?;
        let root = directory(&app, &db)?;
        let (id, _, _) = data(&contents)?;
        let configured: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM settings WHERE key='directory')",
                [],
                |r| r.get(0),
            )
            .map_err(err)?;
        if lookup(&db, &id)?.is_none() && configured && !root.is_dir() {
            return Err("默认项目目录不可用，请连接磁盘或更改目录；未创建新位置".into());
        }
        save(&mut db, &root, &contents, thumbnail)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn workspace_remember(
    app: tauri::AppHandle,
    path: String,
    hash: String,
    thumbnail: Option<String>,
) -> Result<Entry> {
    let target = PathBuf::from(path);
    if !target.is_absolute() || !(app.fs_scope().is_allowed(&target) || known_path(&app, &target)) {
        return Err("此项目文件尚未授权".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (contents, actual) = read_snapshot(&target)?;
        if actual != hash {
            return Err("文件已被修改，未更新项目关联".into());
        }
        record(&db(&app)?, &target, &hash, &contents, thumbnail)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn workspace_lookup(app: tauri::AppHandle, id: String) -> Result<Option<Entry>> {
    tauri::async_runtime::spawn_blocking(move || lookup(&db(&app)?, &id))
        .await
        .map_err(err)?
}
#[tauri::command]
pub async fn workspace_open(app: tauri::AppHandle, id: String) -> Result<Opened> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = db(&app)?;
        let mut entry = lookup(&db, &id)?.ok_or("找不到项目记录，请重新定位文件")?;
        let path = PathBuf::from(&entry.path);
        let (contents, hash) = read_snapshot(&path)?;
        let (file_id, _, _) = data(&contents)?;
        if file_id != id {
            return Err("文件的项目标识已变化，请通过打开项目文件重新选择".into());
        }
        let changed = hash != entry.hash;
        entry.hash = hash;
        entry.accessed_at = now();
        db.execute(
            "UPDATE projects SET accessed_at=? WHERE id=?",
            params![entry.accessed_at, id],
        )
        .map_err(err)?;
        Ok(Opened {
            entry,
            contents,
            changed,
        })
    })
    .await
    .map_err(err)?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_save_restart_collision_and_external_conflict() {
        let root = tempfile::tempdir().unwrap();
        let store = root.path().join("library.sqlite");
        let folder = root.path().join("中文目录");
        let first = r#"{"projectId":"id-1","title":"同名/项目","pages":[]}"#;
        let mut db = connect(&store).unwrap();
        let a = save(&mut db, &folder, first, None).unwrap();
        drop(db);
        let mut db = connect(&store).unwrap();
        assert_eq!(lookup(&db, "id-1").unwrap().unwrap().path, a.path);
        let b = save(&mut db, &folder, &first.replace("id-1", "id-2"), None).unwrap();
        assert_ne!(a.path, b.path);
        let updated = save(
            &mut db,
            &root.path().join("other"),
            &first.replace("同名/项目", "改名"),
            None,
        )
        .unwrap();
        assert_eq!(updated.path, a.path);
        std::fs::write(&a.path, b"external").unwrap();
        assert!(save(&mut db, &folder, first, None).is_err());
        assert_eq!(std::fs::read(&a.path).unwrap(), b"external");
        std::fs::remove_file(&b.path).unwrap();
        assert!(save(&mut db, &folder, &first.replace("id-1", "id-2"), None).is_err());
    }
    #[test]
    fn filename_collision_never_overwrites_and_bad_identity_is_rejected() {
        let root = tempfile::tempdir().unwrap();
        let mut db = connect(&root.path().join("library.sqlite")).unwrap();
        std::fs::write(root.path().join("A.json"), b"existing").unwrap();
        let saved = save(
            &mut db,
            root.path(),
            r#"{"projectId":"p","title":"A","pages":[]}"#,
            None,
        )
        .unwrap();
        assert!(saved.path.ends_with("A (2).json"));
        assert_eq!(
            std::fs::read(root.path().join("A.json")).unwrap(),
            b"existing"
        );
        assert!(
            save(
                &mut db,
                root.path(),
                r#"{"projectId":"../escape","pages":[]}"#,
                None
            )
            .is_err()
        );
    }
    #[test]
    fn reserved_names_and_snapshots_are_safe() {
        let root = tempfile::tempdir().unwrap();
        let mut db = connect(&root.path().join("library.sqlite")).unwrap();
        let entry = save(
            &mut db,
            root.path(),
            r#"{"projectId":"device","title":"CON","pages":[]}"#,
            None,
        )
        .unwrap();
        assert!(entry.path.ends_with("_CON.json"));
        let (text, hash) = read_snapshot(Path::new(&entry.path)).unwrap();
        assert_eq!(data(&text).unwrap().0, "device");
        assert_eq!(hash, entry.hash);
        assert!(data("\u{feff}{\"projectId\":\"bom\",\"pages\":[]}").is_ok());
    }
}

use crate::project_files::write_checked;
use rusqlite::{params, Connection, OptionalExtension};
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
    preferences: LibraryPreferences,
}
#[derive(Default, Serialize)]
pub struct LibraryPreferences {
    pinned: Vec<String>,
    hidden: Vec<String>,
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
    db.execute_batch("CREATE TABLE IF NOT EXISTS library_preferences(id TEXT PRIMARY KEY,pinned INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0);").map_err(err)?;
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
fn preferences(db: &Connection) -> Result<LibraryPreferences> {
    let mut result = LibraryPreferences::default();
    let mut statement = db
        .prepare("SELECT id,pinned,hidden FROM library_preferences ORDER BY id")
        .map_err(err)?;
    for item in statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, bool>(1)?,
                row.get::<_, bool>(2)?,
            ))
        })
        .map_err(err)?
    {
        let (id, pinned, hidden) = item.map_err(err)?;
        if pinned && !hidden {
            result.pinned.push(id.clone());
        }
        if hidden {
            result.hidden.push(id);
        }
    }
    Ok(result)
}
fn update_library(
    db: &mut Connection,
    id: Option<&str>,
    action: &str,
) -> Result<LibraryPreferences> {
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    if action == "restore-all" {
        tx.execute("UPDATE library_preferences SET hidden=0", [])
            .map_err(err)?;
    } else {
        let id = id
            .filter(|id| {
                !id.is_empty()
                    && id.len() <= 80
                    && id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
            })
            .ok_or("项目标识无效，未修改最近记录")?;
        let current = preferences(&tx)?;
        if action == "pin"
            && current.pinned.len() >= 12
            && !current.pinned.iter().any(|value| value == id)
        {
            return Err("最多固定 12 个项目，请先取消其他项目的固定".into());
        }
        tx.execute(
            "INSERT OR IGNORE INTO library_preferences(id) VALUES(?)",
            [id],
        )
        .map_err(err)?;
        match action {
            "pin" => {
                tx.execute(
                    "UPDATE library_preferences SET pinned=1,hidden=0 WHERE id=?",
                    [id],
                )
                .map_err(err)?;
            }
            "unpin" => {
                tx.execute("UPDATE library_preferences SET pinned=0 WHERE id=?", [id])
                    .map_err(err)?;
            }
            "hide" => {
                tx.execute(
                    "UPDATE library_preferences SET hidden=1,pinned=0 WHERE id=?",
                    [id],
                )
                .map_err(err)?;
            }
            "show" => {
                tx.execute("UPDATE library_preferences SET hidden=0 WHERE id=?", [id])
                    .map_err(err)?;
            }
            _ => return Err("不支持的最近项目操作".into()),
        }
    }
    let result = preferences(&tx)?;
    tx.commit().map_err(err)?;
    Ok(result)
}
fn recent_projects(db: &Connection, query: &str, prefs: &LibraryPreferences) -> Result<Vec<Entry>> {
    let query = query.trim().replace('\\', "/").to_lowercase();
    let mut statement = db
        .prepare("SELECT id,title,path,accessed_at FROM projects")
        .map_err(err)?;
    let mut candidates = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })
        .map_err(err)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(err)?;
    candidates.retain(|(id, title, path, _)| {
        !prefs.hidden.contains(id)
            && (query.is_empty()
                || title.to_lowercase().contains(&query)
                || path.replace('\\', "/").to_lowercase().contains(&query))
    });
    candidates.sort_by(|a, b| {
        prefs
            .pinned
            .contains(&b.0)
            .cmp(&prefs.pinned.contains(&a.0))
            .then(b.3.cmp(&a.3))
            .then(a.0.cmp(&b.0))
    });
    candidates
        .into_iter()
        .take(12)
        .map(|(id, _, _, _)| lookup(db, &id)?.ok_or("项目记录已变化，请刷新".into()))
        .collect()
}
#[tauri::command]
pub async fn workspace_library_update(
    app: tauri::AppHandle,
    id: Option<String>,
    action: String,
) -> Result<LibraryPreferences> {
    tauri::async_runtime::spawn_blocking(move || {
        update_library(&mut db(&app)?, id.as_deref(), &action)
    })
    .await
    .map_err(err)?
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
    db.execute("UPDATE library_preferences SET hidden=0 WHERE id=?", [&id])
        .map_err(err)?;
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
pub async fn workspace_info(
    app: tauri::AppHandle,
    recovery_ids: Option<Vec<String>>,
    search: Option<String>,
) -> Result<Info> {
    tauri::async_runtime::spawn_blocking(move || {
        let db = db(&app)?;
        let directory = directory(&app, &db)?.to_string_lossy().into_owned();
        let preferences = preferences(&db)?;
        let query = search.unwrap_or_default();
        if query.chars().count() > 200 {
            return Err("搜索内容最多 200 个字符".into());
        }
        let mut projects = recent_projects(&db, &query, &preferences)?;
        let mut candidates = recovery_ids
            .unwrap_or_default()
            .into_iter()
            .take(2000)
            .filter(|id| !preferences.hidden.contains(id))
            .collect::<Vec<_>>();
        candidates.sort_by_key(|id| !preferences.pinned.contains(id));
        for id in candidates.into_iter().take(12) {
            if !projects.iter().any(|entry| entry.id == id) {
                if let Some(entry) = lookup(&db, &id)? {
                    projects.push(entry);
                }
            }
        }
        Ok(Info {
            directory,
            projects,
            preferences,
        })
    })
    .await
    .map_err(err)?
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
// A relocation only updates the registry. Neither the old nor the picked file is written.
fn relocate(
    db: &mut Connection,
    id: &str,
    target: &Path,
    hash: &str,
    previous_path: &str,
    previous_hash: &str,
    thumbnail: Option<String>,
) -> Result<Entry> {
    let (contents, actual) = read_snapshot(target)?;
    if actual != hash {
        return Err("所选文件已再次变化，请重新定位并核对版本；原关联保留".into());
    }
    if data(&contents)?.0 != id {
        return Err("所选文件不是同一个项目，原关联保留".into());
    }
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(err)?;
    let previous = lookup(&tx, id)?.ok_or("原项目记录已不存在，请重新打开项目首页")?;
    if previous.path != previous_path || previous.hash != previous_hash {
        return Err("项目关联已变化，请重新打开卡片后定位；未覆盖现有关联".into());
    }
    let entry = record(&tx, target, hash, &contents, thumbnail)?;
    tx.commit().map_err(err)?;
    Ok(entry)
}
#[tauri::command]
pub async fn workspace_relocate(
    app: tauri::AppHandle,
    id: String,
    path: String,
    hash: String,
    previous_path: String,
    previous_hash: String,
    thumbnail: Option<String>,
) -> Result<Entry> {
    let target = PathBuf::from(path);
    if !target.is_absolute() || !app.fs_scope().is_allowed(&target) {
        return Err("请通过文件选择器授权要重新定位的项目文件".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        relocate(
            &mut db(&app)?,
            &id,
            &target,
            &hash,
            &previous_path,
            &previous_hash,
            thumbnail,
        )
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn workspace_open(app: tauri::AppHandle, id: String) -> Result<Opened> {
    tauri::async_runtime::spawn_blocking(move || open_project(&db(&app)?, &id, true))
        .await
        .map_err(err)?
}
#[tauri::command]
pub async fn workspace_snapshot(app: tauri::AppHandle, id: String) -> Result<Opened> {
    tauri::async_runtime::spawn_blocking(move || open_project(&db(&app)?, &id, false))
        .await
        .map_err(err)?
}
fn open_project(db: &Connection, id: &str, touch: bool) -> Result<Opened> {
    let mut entry = lookup(db, id)?.ok_or("找不到项目记录，请重新定位文件")?;
    let path = PathBuf::from(&entry.path);
    let (contents, hash) = read_snapshot(&path)?;
    let (file_id, _, _) = data(&contents)?;
    if file_id != id {
        return Err("文件的项目标识已变化，请通过打开项目文件重新选择".into());
    }
    let changed = hash != entry.hash;
    entry.hash = hash;
    if touch {
        entry.accessed_at = now();
        db.execute(
            "UPDATE projects SET accessed_at=? WHERE id=?",
            params![entry.accessed_at, id],
        )
        .map_err(err)?;
        db.execute("UPDATE library_preferences SET hidden=0 WHERE id=?", [id])
            .map_err(err)?;
    }
    Ok(Opened {
        entry,
        contents,
        changed,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relocation_changes_only_the_binding_then_future_saves_use_the_new_path() {
        let root = tempfile::tempdir().unwrap();
        let store = root.path().join("library.sqlite");
        let mut db = connect(&store).unwrap();
        let original = r#"{"projectId":"moved","title":"原文件","pages":[]}"#;
        let old = save(&mut db, root.path(), original, None).unwrap();
        update_library(&mut db, Some("moved"), "pin").unwrap();
        let target = root.path().join("新位置.json");
        let candidate = original.replace("原文件", "新位置版本");
        std::fs::write(&target, &candidate).unwrap();
        let (_, hash) = read_snapshot(&target).unwrap();
        let moved = relocate(&mut db, "moved", &target, &hash, &old.path, &old.hash, None).unwrap();
        assert_eq!(moved.path, target.to_string_lossy());
        assert_eq!(std::fs::read_to_string(&old.path).unwrap(), original);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), candidate);
        assert_eq!(preferences(&db).unwrap().pinned, vec!["moved"]);
        drop(db);
        let mut db = connect(&store).unwrap();
        assert_eq!(lookup(&db, "moved").unwrap().unwrap().path, moved.path);
        let edited = candidate.replace("新位置版本", "继续编辑");
        let saved = save(&mut db, root.path(), &edited, None).unwrap();
        assert_eq!(saved.path, moved.path);
        assert_eq!(std::fs::read_to_string(&target).unwrap(), edited);
        assert_eq!(std::fs::read_to_string(&old.path).unwrap(), original);
    }
    #[test]
    fn relocation_rejects_wrong_identity_changed_candidate_and_stale_binding() {
        let root = tempfile::tempdir().unwrap();
        let mut db = connect(&root.path().join("library.sqlite")).unwrap();
        let data = r#"{"projectId":"original","title":"原项目","pages":[]}"#;
        let old = save(&mut db, root.path(), data, None).unwrap();
        let target = root.path().join("picked.json");
        std::fs::write(&target, data.replace("original", "other")).unwrap();
        let (_, wrong_hash) = read_snapshot(&target).unwrap();
        assert!(relocate(
            &mut db,
            "original",
            &target,
            &wrong_hash,
            &old.path,
            &old.hash,
            None
        )
        .is_err());
        std::fs::write(&target, data).unwrap();
        let (_, hash) = read_snapshot(&target).unwrap();
        assert!(relocate(
            &mut db,
            "original",
            &target,
            &wrong_hash,
            &old.path,
            &old.hash,
            None
        )
        .is_err());
        assert!(relocate(
            &mut db,
            "original",
            &target,
            &hash,
            "stale-path",
            &old.hash,
            None
        )
        .is_err());
        assert!(relocate(
            &mut db,
            "original",
            &target,
            &hash,
            &old.path,
            "stale-hash",
            None
        )
        .is_err());
        assert_eq!(lookup(&db, "original").unwrap().unwrap().path, old.path);
        assert_eq!(std::fs::read_to_string(&old.path).unwrap(), data);
        std::fs::remove_file(&old.path).unwrap();
        relocate(
            &mut db, "original", &target, &hash, &old.path, &old.hash, None,
        )
        .unwrap();
        assert!(
            !Path::new(&old.path).exists(),
            "relocation does not recreate the missing original"
        );
    }
    #[test]
    fn relocation_registry_collision_rolls_back_without_touching_files() {
        let root = tempfile::tempdir().unwrap();
        let mut db = connect(&root.path().join("library.sqlite")).unwrap();
        let data = r#"{"projectId":"one","pages":[]}"#;
        let old = save(&mut db, root.path(), data, None).unwrap();
        let other = save(&mut db, root.path(), &data.replace("one", "two"), None).unwrap();
        std::fs::write(&other.path, data).unwrap();
        let (_, hash) = read_snapshot(Path::new(&other.path)).unwrap();
        update_library(&mut db, Some("one"), "hide").unwrap();
        assert!(relocate(
            &mut db,
            "one",
            Path::new(&other.path),
            &hash,
            &old.path,
            &old.hash,
            None
        )
        .is_err());
        assert_eq!(lookup(&db, "one").unwrap().unwrap().path, old.path);
        assert_eq!(preferences(&db).unwrap().hidden, vec!["one"]);
        assert_eq!(std::fs::read_to_string(&other.path).unwrap(), data);
    }
    #[test]
    fn library_preferences_survive_restart_without_deleting_project_data() {
        let root = tempfile::tempdir().unwrap();
        let store = root.path().join("library.sqlite");
        let mut db = connect(&store).unwrap();
        let data = r#"{"projectId":"pinned","title":"中文项目","pages":[]}"#;
        let entry = save(&mut db, root.path(), data, None).unwrap();
        update_library(&mut db, Some("pinned"), "pin").unwrap();
        drop(db);
        let mut db = connect(&store).unwrap();
        assert_eq!(preferences(&db).unwrap().pinned, vec!["pinned"]);
        let hidden = update_library(&mut db, Some("pinned"), "hide").unwrap();
        assert!(hidden.pinned.is_empty());
        assert_eq!(hidden.hidden, vec!["pinned"]);
        assert!(recent_projects(&db, "", &hidden).unwrap().is_empty());
        assert_eq!(std::fs::read_to_string(&entry.path).unwrap(), data);
        assert_eq!(lookup(&db, "pinned").unwrap().unwrap().hash, entry.hash);
        assert_eq!(open_project(&db, "pinned", false).unwrap().contents, data);
        update_library(&mut db, None, "restore-all").unwrap();
        assert_eq!(
            recent_projects(&db, "", &preferences(&db).unwrap())
                .unwrap()
                .len(),
            1
        );
        update_library(&mut db, Some("pinned"), "hide").unwrap();
        save(&mut db, root.path(), data, None).unwrap();
        assert!(preferences(&db).unwrap().hidden.is_empty());
    }
    #[test]
    fn library_search_and_pins_work_beyond_the_recent_limit() {
        let root = tempfile::tempdir().unwrap();
        let mut db = connect(&root.path().join("library.sqlite")).unwrap();
        for i in 0..20 {
            let id = format!("id-{i}");
            let data = format!(r#"{{"projectId":"{id}","title":"说明_100% ÄBC {i}","pages":[]}}"#);
            save(&mut db, root.path(), &data, None).unwrap();
            db.execute(
                "UPDATE projects SET accessed_at=? WHERE id=?",
                params![i, id],
            )
            .unwrap();
        }
        let prefs = update_library(&mut db, Some("id-0"), "pin").unwrap();
        let recent = recent_projects(&db, "", &prefs).unwrap();
        assert_eq!(recent.len(), 12);
        assert_eq!(recent[0].id, "id-0");
        assert_eq!(recent[1].id, "id-19");
        assert_eq!(recent_projects(&db, "äbc 0", &prefs).unwrap()[0].id, "id-0");
        assert_eq!(recent_projects(&db, "%", &prefs).unwrap().len(), 12);
        assert!(recent_projects(&db, "not-found", &prefs)
            .unwrap()
            .is_empty());
        let path = lookup(&db, "id-1")
            .unwrap()
            .unwrap()
            .path
            .replace('\\', "/")
            .to_uppercase();
        assert_eq!(recent_projects(&db, &path, &prefs).unwrap()[0].id, "id-1");
        for i in 1..12 {
            update_library(&mut db, Some(&format!("id-{i}")), "pin").unwrap();
        }
        assert!(update_library(&mut db, Some("id-12"), "pin").is_err());
        assert!(update_library(&mut db, Some("invalid"), "delete").is_err());
        assert!(lookup(&db, "id-12").unwrap().is_some());
        assert!(update_library(&mut db, Some("../escape"), "pin").is_err());
        assert_eq!(preferences(&db).unwrap().pinned.len(), 12);
    }
    #[test]
    fn snapshots_do_not_acknowledge_external_changes_or_touch_recent_order() {
        let root = tempfile::tempdir().unwrap();
        let mut db = connect(&root.path().join("library.sqlite")).unwrap();
        let data = r#"{"projectId":"snapshot","title":"原版","pages":[]}"#;
        let entry = save(&mut db, root.path(), data, None).unwrap();
        db.execute("UPDATE projects SET accessed_at=1 WHERE id='snapshot'", [])
            .unwrap();
        let current = open_project(&db, "snapshot", false).unwrap();
        assert!(!current.changed);
        assert_eq!(lookup(&db, "snapshot").unwrap().unwrap().accessed_at, 1);
        std::fs::write(&entry.path, data.replace("原版", "外部修改")).unwrap();
        let changed = open_project(&db, "snapshot", false).unwrap();
        assert!(changed.changed);
        assert_eq!(lookup(&db, "snapshot").unwrap().unwrap().hash, entry.hash);
        assert!(save(&mut db, root.path(), data, None).is_err());
        assert!(open_project(&db, "snapshot", true).unwrap().changed);
        assert!(lookup(&db, "snapshot").unwrap().unwrap().accessed_at > 1);
    }
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
        assert!(save(
            &mut db,
            root.path(),
            r#"{"projectId":"../escape","pages":[]}"#,
            None
        )
        .is_err());
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

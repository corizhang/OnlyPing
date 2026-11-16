use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::Path;
use tauri::Manager;

#[derive(Debug, Serialize)]
pub struct StoreError {
    code: &'static str,
    message: &'static str,
}
type Result<T> = std::result::Result<T, StoreError>;
fn invalid() -> StoreError {
    StoreError {
        code: "invalid",
        message: "存档结构损坏或图片资源缺失，未覆盖原数据",
    }
}
impl From<rusqlite::Error> for StoreError {
    fn from(_: rusqlite::Error) -> Self {
        Self {
            code: "database",
            message: "桌面数据库操作失败，请检查磁盘空间、文件占用或损坏；保留窗口并导出备份",
        }
    }
}
fn decode(text: String) -> Result<Value> {
    serde_json::from_str(&text).map_err(|_| invalid())
}
fn open(path: &Path) -> Result<Connection> {
    let connection = Connection::open(path)?;
    connection.busy_timeout(std::time::Duration::from_secs(5))?;
    let version: i64 = connection.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > 1 {
        return Err(StoreError {
            code: "version",
            message: "数据库来自较新版本，请升级 OnlyPing 后打开",
        });
    }
    connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")?;
    if version == 0 {
        connection.execute_batch("BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL, version INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS assets (key TEXT PRIMARY KEY, image TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        PRAGMA user_version=1; COMMIT;")?;
    }
    Ok(connection)
}
fn connect(app: &tauri::AppHandle) -> Result<Connection> {
    let root = app.path().app_local_data_dir().map_err(|_| invalid())?;
    std::fs::create_dir_all(&root).map_err(|_| StoreError {
        code: "directory",
        message: "无法创建应用数据目录，请检查磁盘与访问权限",
    })?;
    open(&root.join("onlyping.sqlite3"))
}

// Recovery must remain usable even if SQLite cannot be opened. No frontend path input.
#[tauri::command]
pub fn project_storage_location(app: tauri::AppHandle) -> Result<String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| invalid())?
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
pub fn project_storage_open_directory(app: tauri::AppHandle) -> Result<()> {
    let root = app.path().app_local_data_dir().map_err(|_| invalid())?;
    std::fs::create_dir_all(&root).map_err(|_| StoreError {
        code: "directory",
        message: "无法访问应用数据目录",
    })?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg(root)
            .spawn()
            .map_err(|_| StoreError {
                code: "directory",
                message: "无法打开资源管理器，请复制数据目录路径手动查看",
            })?;
        Ok(())
    }
    #[cfg(not(windows))]
    Err(StoreError {
        code: "unsupported",
        message: "此平台尚不支持自动打开数据目录，请复制路径手动查看",
    })
}
fn get(db: &Connection, key: &str) -> Result<Option<(Value, i64)>> {
    let row: Option<(String, i64)> = db
        .query_row(
            "SELECT value, version FROM records WHERE key=?1",
            [key],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    row.map(|(text, version)| Ok((decode(text)?, version)))
        .transpose()
}
fn put(db: &Connection, key: &str, value: &Value, version: i64) -> Result<()> {
    db.execute("INSERT INTO records(key,value,version) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value=excluded.value,version=excluded.version", params![key, value.to_string(), version])?;
    Ok(())
}
fn ready(db: &Connection) -> Result<bool> {
    Ok(db
        .query_row(
            "SELECT value FROM meta WHERE key='indexeddb-migrated'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()?
        .is_some())
}
fn require_ready(db: &Connection) -> Result<()> {
    if ready(db)? {
        Ok(())
    } else {
        Err(StoreError {
            code: "migration",
            message: "旧存档迁移尚未完成，已暂停读写",
        })
    }
}
fn project_key(data: &Value) -> Result<String> {
    if !data.is_object() {
        return Err(invalid());
    }
    let id = match data.get("projectId") {
        None => "legacy",
        Some(value) => value
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(invalid)?,
    };
    Ok(format!("project:{id}"))
}
fn valid_key(key: &str) -> bool {
    key == "autosave"
        || key == "backup"
        || ["project:", "history:project:", "deleted:project:"]
            .iter()
            .any(|prefix| key.strip_prefix(prefix).is_some_and(|id| !id.is_empty()))
}
fn references(data: &Value) -> Result<Vec<String>> {
    project_key(data)?;
    if data.get("schemaVersion").is_some_and(|v| v != 1) {
        return Err(invalid());
    }
    if !data.get("title").is_none_or(Value::is_string) {
        return Err(invalid());
    }
    let pages = data
        .get("pages")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    let mut ids = HashSet::new();
    let mut result = Vec::new();
    for page in pages {
        let id = page
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or_else(invalid)?;
        if !ids.insert(id) {
            return Err(invalid());
        }
        for snapshot in std::iter::once(page).chain(page.get("orig").filter(|v| !v.is_null())) {
            for size in ["width", "height"] {
                if !snapshot
                    .get(size)
                    .and_then(Value::as_f64)
                    .is_some_and(|v| v > 0.0 && v.is_finite())
                {
                    return Err(invalid());
                }
            }
            if !snapshot.get("annotations").is_some_and(Value::is_array) {
                return Err(invalid());
            }
            result.push(
                snapshot
                    .get("image")
                    .and_then(Value::as_str)
                    .ok_or_else(invalid)?
                    .into(),
            );
        }
    }
    Ok(result)
}
fn hydrate(db: &Connection, data: &mut Value) -> Result<()> {
    if let Some(values) = data.as_array_mut() {
        for value in values {
            hydrate(db, value)?;
        }
        return Ok(());
    }
    references(data)?;
    for page in data["pages"].as_array_mut().ok_or_else(invalid)? {
        hydrate_image(db, page)?;
        if let Some(orig) = page.get_mut("orig").filter(|v| !v.is_null()) {
            hydrate_image(db, orig)?;
        }
    }
    Ok(())
}
fn hydrate_image(db: &Connection, value: &mut Value) -> Result<()> {
    let image = value["image"].as_str().ok_or_else(invalid)?;
    if image.starts_with("asset:") {
        let resolved: String = db
            .query_row("SELECT image FROM assets WHERE key=?1", [image], |r| {
                r.get(0)
            })
            .optional()?
            .ok_or_else(invalid)?;
        value["image"] = Value::String(resolved);
    } else if !image.starts_with("data:image/") {
        return Err(invalid());
    }
    Ok(())
}
fn check_assets(db: &Connection, data: &Value) -> Result<()> {
    for image in references(data)? {
        if image.starts_with("asset:") {
            if !db.query_row(
                "SELECT EXISTS(SELECT 1 FROM assets WHERE key=?1)",
                [&image],
                |r| r.get::<_, bool>(0),
            )? {
                return Err(invalid());
            }
        } else if !image.starts_with("data:image/") {
            return Err(invalid());
        }
    }
    Ok(())
}
fn insert_assets(db: &Connection, assets: &[(String, String)]) -> Result<()> {
    for (key, image) in assets {
        if !image.starts_with("data:image/")
            || *key != format!("asset:{:x}", Sha256::digest(image.as_bytes()))
        {
            return Err(invalid());
        }
        db.execute(
            "INSERT OR IGNORE INTO assets(key,image) VALUES(?1,?2)",
            params![key, image],
        )?;
    }
    Ok(())
}
fn collect(db: &Connection) -> Result<()> {
    let mut used = HashSet::new();
    let mut stmt = db.prepare("SELECT key,value FROM records")?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (key, text) = row?;
        if key.starts_with("deleted:") {
            continue;
        }
        let value = decode(text)?;
        if let Some(values) = value.as_array() {
            for v in values {
                used.extend(references(v)?);
            }
        } else {
            used.extend(references(&value)?);
        }
    }
    let mut stmt = db.prepare("SELECT key FROM assets")?;
    let keys = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for key in keys {
        if !used.contains(&key) {
            db.execute("DELETE FROM assets WHERE key=?1", [key])?;
        }
    }
    Ok(())
}
#[derive(Deserialize)]
pub struct LegacySnapshot {
    records: Vec<(String, Value)>,
    assets: Vec<(String, String)>,
}
fn migrate(db: &mut Connection, snapshot: LegacySnapshot) -> Result<()> {
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if ready(&tx)? {
        return Ok(());
    }
    if tx.query_row("SELECT COUNT(*) FROM records", [], |r| r.get::<_, i64>(0))? != 0 {
        return Err(invalid());
    }
    insert_assets(&tx, &snapshot.assets)?;
    let mut keys = HashSet::new();
    for (key, value) in snapshot.records {
        if !valid_key(&key) || !keys.insert(key.clone()) {
            return Err(invalid());
        }
        if key.starts_with("deleted:") {
            if value != true {
                return Err(invalid());
            }
        } else if key.starts_with("history:") {
            let values = value
                .as_array()
                .filter(|v| v.len() <= 3)
                .ok_or_else(invalid)?;
            for v in values {
                check_assets(&tx, v)?;
                if format!("history:{}", project_key(v)?) != key {
                    return Err(invalid());
                }
            }
        } else {
            check_assets(&tx, &value)?;
            if key.starts_with("project:") && project_key(&value)? != key {
                return Err(invalid());
            }
        }
        put(&tx, &key, &value, 1)?;
    }
    // The source remains untouched; marker and imported data commit together.
    tx.execute(
        "INSERT INTO meta(key,value) VALUES('indexeddb-migrated','1')",
        [],
    )?;
    tx.commit()?;
    Ok(())
}
fn save(
    db: &mut Connection,
    data: Value,
    expected: Option<i64>,
    assets: Vec<(String, String)>,
) -> Result<i64> {
    let key = project_key(&data)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    require_ready(&tx)?;
    if get(&tx, &format!("deleted:{key}"))?.is_some() {
        return Err(StoreError {
            code: "deleted",
            message: "此项目已在其他窗口删除，请导出备份后作为新项目导入",
        });
    }
    let previous = get(&tx, &key)?;
    let fingerprint = |v: &Value| {
        let mut value = v.clone();
        value["savedAt"] = json!(0);
        value
    };
    let unchanged = previous
        .as_ref()
        .is_some_and(|(old, _)| fingerprint(old) == fingerprint(&data));
    if let Some((_, version)) = &previous {
        if !unchanged && expected != Some(*version) {
            return Err(StoreError {
                code: "conflict",
                message: "此项目已在其他窗口修改，请重新打开",
            });
        }
    }
    insert_assets(&tx, &assets)?;
    check_assets(&tx, &data)?;
    let version = previous
        .as_ref()
        .map_or(1, |(_, v)| if unchanged { *v } else { v + 1 });
    if let Some((old, old_version)) = &previous {
        if !unchanged {
            put(&tx, "backup", old, *old_version)?;
            let history_key = format!("history:{key}");
            let mut history = get(&tx, &history_key)?
                .map(|(v, _)| v.as_array().cloned().ok_or_else(invalid))
                .transpose()?
                .unwrap_or_default();
            history.insert(0, old.clone());
            history.truncate(3);
            put(&tx, &history_key, &json!(history), version)?;
        }
    }
    let saved = if unchanged {
        &previous.as_ref().unwrap().0
    } else {
        &data
    };
    put(&tx, &key, saved, version)?;
    put(&tx, "autosave", saved, version)?;
    collect(&tx)?;
    tx.commit()?;
    Ok(version)
}
fn read(db: &mut Connection, key: &str) -> Result<Value> {
    if !valid_key(key) || key.starts_with("deleted:") {
        return Err(invalid());
    }
    let tx = db.transaction()?;
    require_ready(&tx)?;
    let result = match get(&tx, key)? {
        None => json!({ "value": null }),
        Some((mut value, version)) => {
            let project_key = if value.is_array() {
                None
            } else {
                Some(project_key(&value)?)
            };
            hydrate(&tx, &mut value)?;
            json!({ "value": value, "version": version, "projectKey": project_key })
        }
    };
    tx.commit()?;
    Ok(result)
}
fn delete(db: &mut Connection, key: &str) -> Result<()> {
    if !key.starts_with("project:") || key.len() <= 8 {
        return Err(invalid());
    }
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    require_ready(&tx)?;
    tx.execute(
        "DELETE FROM records WHERE key=?1 OR key=?2",
        params![key, format!("history:{key}")],
    )?;
    put(&tx, &format!("deleted:{key}"), &json!(true), 1)?;
    for alias in ["autosave", "backup"] {
        if let Some((value, _)) = get(&tx, alias)? {
            if project_key(&value)? == key {
                tx.execute("DELETE FROM records WHERE key=?1", [alias])?;
            }
        }
    }
    collect(&tx)?;
    tx.commit()?;
    Ok(())
}

// Disk and JSON work runs outside the GUI thread. Each command owns its connection;
// SQLite transactions serialize writers across windows and application instances.
async fn run<T: Send + 'static>(
    app: tauri::AppHandle,
    task: impl FnOnce(&mut Connection) -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move || task(&mut connect(&app)?))
        .await
        .map_err(|_| StoreError {
            code: "worker",
            message: "存储任务未完成，请保留窗口并重试",
        })?
}
#[tauri::command]
pub async fn project_storage_ready(app: tauri::AppHandle) -> Result<bool> {
    run(app, |db| ready(db)).await
}
#[tauri::command]
pub async fn project_storage_migrate(
    app: tauri::AppHandle,
    snapshot: LegacySnapshot,
) -> Result<()> {
    run(app, move |db| migrate(db, snapshot)).await
}
#[tauri::command]
pub async fn project_storage_save(
    app: tauri::AppHandle,
    data: Value,
    expected_version: Option<i64>,
    assets: Vec<(String, String)>,
) -> Result<i64> {
    run(app, move |db| save(db, data, expected_version, assets)).await
}
#[tauri::command]
pub async fn project_storage_read(app: tauri::AppHandle, key: String) -> Result<Value> {
    run(app, move |db| read(db, &key)).await
}
#[tauri::command]
pub async fn project_storage_delete(app: tauri::AppHandle, key: String) -> Result<()> {
    run(app, move |db| delete(db, &key)).await
}
#[tauri::command]
pub async fn project_storage_missing_assets(
    app: tauri::AppHandle,
    keys: Vec<String>,
) -> Result<Vec<String>> {
    run(app, move |db| {
        require_ready(db)?;
        keys.into_iter()
            .filter_map(|key| {
                match db.query_row(
                    "SELECT EXISTS(SELECT 1 FROM assets WHERE key=?1)",
                    [&key],
                    |r| r.get::<_, bool>(0),
                ) {
                    Ok(true) => None,
                    Ok(false) => Some(Ok(key)),
                    Err(e) => Some(Err(e.into())),
                }
            })
            .collect()
    })
    .await
}
#[tauri::command]
pub async fn project_storage_list(app: tauri::AppHandle) -> Result<Vec<Value>> {
    run(app, |db| list(db)).await
}
fn list(db: &Connection) -> Result<Vec<Value>> {
    require_ready(db)?;
    let mut stmt = db.prepare(
        "SELECT key,value FROM records WHERE key LIKE 'project:%' OR key LIKE 'history:project:%'",
    )?;
    let mut result = Vec::new();
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (key, text) = row?;
        let value = decode(text)?;
        let mut add = |v: &Value, revision: Option<usize>| -> Result<()> {
            let count = v
                .get("pages")
                .and_then(Value::as_array)
                .ok_or_else(invalid)?
                .len();
            let mut entry = json!({ "key": key, "title": v.get("title").and_then(Value::as_str).unwrap_or("明白纸"), "savedAt": v.get("savedAt").and_then(Value::as_f64).unwrap_or(0.0), "pages": count });
            if let Some(i) = revision {
                entry["revision"] = json!(i);
            }
            result.push(entry);
            Ok(())
        };
        if key.starts_with("history:") {
            for (i, v) in value.as_array().ok_or_else(invalid)?.iter().enumerate() {
                add(v, Some(i))?;
            }
        } else {
            add(&value, None)?;
        }
    }
    result.sort_by(|a, b| {
        b["savedAt"]
            .as_f64()
            .unwrap_or(0.0)
            .total_cmp(&a["savedAt"].as_f64().unwrap_or(0.0))
    });
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Connection {
        let mut db = open(Path::new(":memory:")).unwrap();
        migrate(
            &mut db,
            LegacySnapshot {
                records: vec![],
                assets: vec![],
            },
        )
        .unwrap();
        db
    }
    fn asset(text: &str) -> (String, String) {
        let image = format!("data:image/png;base64,{text}");
        (
            format!("asset:{:x}", Sha256::digest(image.as_bytes())),
            image,
        )
    }
    fn project(id: &str, title: &str, image: &str) -> Value {
        json!({ "projectId": id, "schemaVersion": 1, "title": title, "savedAt": 1,
            "pages": [{ "id": "p", "name": "步骤", "notes": "中文说明", "notesRich": "<p><strong>中文</strong></p>", "image": image, "width": 100, "height": 80, "annotations": [{"kind":"text", "id":"t", "text":"标注", "x":1,"y":2,"color":"#fff"}],
                "orig": {"image":image,"width":100,"height":80,"annotations":[]} }] })
    }
    fn count(db: &Connection, table: &str) -> i64 {
        db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap()
    }
    #[test]
    fn migrates_all_aliases_history_and_tombstones_once() {
        let mut db = open(Path::new(":memory:")).unwrap();
        assert!(!ready(&db).unwrap());
        let (key, image) = asset("eA==");
        let data = project("中文项目", "标题", &key);
        migrate(
            &mut db,
            LegacySnapshot {
                records: vec![
                    ("project:中文项目".into(), data.clone()),
                    ("autosave".into(), data.clone()),
                    ("backup".into(), data.clone()),
                    ("history:project:中文项目".into(), json!([data])),
                    ("deleted:project:old".into(), json!(true)),
                ],
                assets: vec![(key, image.clone())],
            },
        )
        .unwrap();
        assert!(ready(&db).unwrap());
        assert_eq!(count(&db, "records"), 5);
        assert_eq!(
            read(&mut db, "autosave").unwrap()["value"]["pages"][0]["image"],
            image
        );
        assert_eq!(
            read(&mut db, "history:project:中文项目").unwrap()["value"][0]["pages"][0]["orig"]["image"],
            image
        );
        assert_eq!(list(&db).unwrap().len(), 2);
        // Retrying migration cannot replace newer SQLite data.
        migrate(
            &mut db,
            LegacySnapshot {
                records: vec![],
                assets: vec![],
            },
        )
        .unwrap();
        assert_eq!(count(&db, "records"), 5);
    }
    #[test]
    fn failed_migration_rolls_back_records_assets_and_marker_then_retries() {
        let mut db = open(Path::new(":memory:")).unwrap();
        let (key, image) = asset("eA==");
        let data = project("a", "保留", &key);
        let snapshot = || LegacySnapshot {
            records: vec![
                ("project:a".into(), data.clone()),
                ("bad-key".into(), json!(false)),
            ],
            assets: vec![(key.clone(), image.clone())],
        };
        assert!(migrate(&mut db, snapshot()).is_err());
        assert_eq!(count(&db, "records"), 0);
        assert_eq!(count(&db, "assets"), 0);
        assert!(!ready(&db).unwrap());
        assert!(save(&mut db, data.clone(), None, vec![]).is_err());
        migrate(
            &mut db,
            LegacySnapshot {
                records: vec![("project:a".into(), data)],
                assets: vec![(key, image)],
            },
        )
        .unwrap();
        assert!(ready(&db).unwrap());
    }
    #[test]
    fn save_history_dedup_unchanged_and_conflict_guards() {
        let mut db = db();
        let (key, image) = asset("eA==");
        let first = project("a", "第一版", &key);
        assert_eq!(
            save(
                &mut db,
                first.clone(),
                None,
                vec![(key.clone(), image.clone())]
            )
            .unwrap(),
            1
        );
        let mut timestamp_only = first.clone();
        timestamp_only["savedAt"] = json!(999);
        assert_eq!(save(&mut db, timestamp_only, None, vec![]).unwrap(), 1);
        assert_eq!(list(&db).unwrap().len(), 1);
        for i in 2..=6 {
            assert_eq!(
                save(
                    &mut db,
                    project("a", &format!("版本{i}"), &key),
                    Some(i - 1),
                    vec![]
                )
                .unwrap(),
                i
            );
        }
        assert_eq!(count(&db, "assets"), 1);
        assert_eq!(
            read(&mut db, "history:project:a").unwrap()["value"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        let before = read(&mut db, "autosave").unwrap();
        assert_eq!(
            save(&mut db, project("a", "过期窗口", &key), Some(1), vec![])
                .unwrap_err()
                .code,
            "conflict"
        );
        assert_eq!(read(&mut db, "autosave").unwrap(), before);
        assert_eq!(
            save(&mut db, project("a", "未读取", &key), None, vec![])
                .unwrap_err()
                .code,
            "conflict"
        );
    }
    #[test]
    fn missing_asset_hash_mismatch_and_invalid_save_never_overwrite() {
        let mut db = db();
        let (key, image) = asset("eA==");
        save(
            &mut db,
            project("a", "原始", &key),
            None,
            vec![(key.clone(), image)],
        )
        .unwrap();
        let before = read(&mut db, "autosave").unwrap();
        assert!(save(&mut db, json!(false), None, vec![]).is_err());
        assert!(
            save(
                &mut db,
                project("a", "缺图", "asset:missing"),
                Some(1),
                vec![]
            )
            .is_err()
        );
        assert!(
            save(
                &mut db,
                project("a", "错误哈希", &key),
                Some(1),
                vec![(key.clone(), "data:image/png;base64,bad".into())]
            )
            .is_err()
        );
        assert!(
            save(
                &mut db,
                json!({"projectId":"a","pages":[{"id":"p"}]}),
                Some(1),
                vec![]
            )
            .is_err()
        );
        assert_eq!(read(&mut db, "autosave").unwrap(), before);
        assert_eq!(count(&db, "assets"), 1);
        assert_eq!(
            save(&mut db, project("a", "重试", &key), Some(1), vec![]).unwrap(),
            2
        );
    }
    #[test]
    fn delete_prunes_history_and_aliases_but_preserves_shared_images_and_tombstones() {
        let mut db = db();
        let (key, image) = asset("eA==");
        save(
            &mut db,
            project("a", "A", &key),
            None,
            vec![(key.clone(), image)],
        )
        .unwrap();
        save(&mut db, project("b", "B", &key), None, vec![]).unwrap();
        save(&mut db, project("a", "A2", &key), Some(1), vec![]).unwrap();
        delete(&mut db, "project:a").unwrap();
        assert_eq!(read(&mut db, "autosave").unwrap()["value"], Value::Null);
        assert_eq!(read(&mut db, "backup").unwrap()["value"], Value::Null);
        assert_eq!(
            read(&mut db, "history:project:a").unwrap()["value"],
            Value::Null
        );
        assert_eq!(count(&db, "assets"), 1);
        assert_eq!(
            save(&mut db, project("a", "复活", &key), Some(2), vec![])
                .unwrap_err()
                .code,
            "deleted"
        );
        assert!(delete(&mut db, "autosave").is_err());
        delete(&mut db, "project:b").unwrap();
        assert_eq!(count(&db, "assets"), 0);
    }
    #[test]
    fn unreferenced_assets_collected_only_after_history_and_backup_release_them() {
        let mut db = db();
        let (first_key, _) = asset("eA0=");
        for i in 0..6 {
            let (key, image) = asset(&format!("eA{i}="));
            save(
                &mut db,
                project("a", &format!("v{i}"), &key),
                if i == 0 { None } else { Some(i) },
                vec![(key, image)],
            )
            .unwrap();
        }
        assert_eq!(count(&db, "assets"), 4);
        assert!(
            !db.query_row(
                "SELECT EXISTS(SELECT 1 FROM assets WHERE key=?1)",
                [first_key],
                |r| r.get::<_, bool>(0)
            )
            .unwrap()
        );
        assert_eq!(
            read(&mut db, "history:project:a").unwrap()["value"][2]["title"],
            "v2"
        );
    }
    #[test]
    fn disk_reopen_and_two_connections_preserve_data_and_reject_stale_writes() {
        let path = std::env::temp_dir().join(format!(
            "onlyping-sqlite-test-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let (key, image) = asset("eA==");
        {
            let mut db = open(&path).unwrap();
            migrate(
                &mut db,
                LegacySnapshot {
                    records: vec![],
                    assets: vec![],
                },
            )
            .unwrap();
            save(
                &mut db,
                project("a", "重启保留", &key),
                None,
                vec![(key.clone(), image.clone())],
            )
            .unwrap();
        }
        {
            let mut a = open(&path).unwrap();
            let mut b = open(&path).unwrap();
            assert_eq!(
                read(&mut b, "autosave").unwrap()["value"]["pages"][0]["image"],
                image
            );
            save(&mut a, project("a", "新窗口修改", &key), Some(1), vec![]).unwrap();
            assert_eq!(
                save(&mut b, project("a", "旧窗口修改", &key), Some(1), vec![])
                    .unwrap_err()
                    .code,
                "conflict"
            );
            assert_eq!(
                read(&mut b, "autosave").unwrap()["value"]["title"],
                "新窗口修改"
            );
            a.execute_batch("BEGIN IMMEDIATE").unwrap();
            b.busy_timeout(std::time::Duration::from_millis(10))
                .unwrap();
            assert_eq!(
                save(&mut b, project("a", "被锁定的写入", &key), Some(2), vec![])
                    .unwrap_err()
                    .code,
                "database"
            );
            assert_eq!(
                read(&mut b, "autosave").unwrap()["value"]["title"],
                "新窗口修改"
            );
            a.execute_batch("ROLLBACK").unwrap();
            assert_eq!(
                save(&mut b, project("a", "解锁重试成功", &key), Some(2), vec![]).unwrap(),
                3
            );
            a.execute_batch("PRAGMA user_version=99").unwrap();
        }
        assert_eq!(open(&path).unwrap_err().code, "version");
        // This exact unique temp file is test-owned; SQLite removes WAL on final close.
        std::fs::remove_file(path).unwrap();
    }
}

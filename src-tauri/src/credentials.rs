// Fixed application credential only: the frontend cannot choose a service/account.
static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(windows)]
fn credential_service(identifier: &str) -> Result<&'static str, String> {
    match identifier {
        "io.github.corizhang.onlyping" => Ok("io.github.corizhang.onlyping"),
        "io.github.corizhang.onlyping.qa" => Ok("io.github.corizhang.onlyping.qa"),
        _ => Err("此应用标识尚未配置系统密钥存储".into()),
    }
}

#[cfg(windows)]
fn entry(app: &tauri::AppHandle) -> Result<keyring::Entry, String> {
    keyring::Entry::new(credential_service(&app.config().identifier)?, "ai-api-key")
        .map_err(|_| "无法访问 Windows 凭据管理器".into())
}

#[tauri::command]
pub fn read_ai_key(_app: tauri::AppHandle) -> Result<Option<String>, String> {
    let _guard = LOCK.lock().map_err(|_| "密钥存储忙，请重启后重试")?;
    #[cfg(windows)]
    {
        match entry(&_app)?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err("读取系统密钥失败".into()),
        }
    }
    #[cfg(not(windows))]
    Err("此平台尚未接入系统密钥存储".into())
}

#[tauri::command]
pub fn write_ai_key(_app: tauri::AppHandle, key: String) -> Result<(), String> {
    if key.len() > 4096 {
        return Err("密钥过长".into());
    }
    let _guard = LOCK.lock().map_err(|_| "密钥存储忙，请重启后重试")?;
    #[cfg(windows)]
    {
        let entry = entry(&_app)?;
        if key.is_empty() {
            match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err("移除系统密钥失败".into()),
            }
        } else {
            entry
                .set_password(&key)
                .map_err(|_| "保存系统密钥失败".into())
        }
    }
    #[cfg(not(windows))]
    Err("此平台尚未接入系统密钥存储".into())
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn qa_credentials_cannot_overwrite_production_service() {
        assert_eq!(
            super::credential_service("io.github.corizhang.onlyping").unwrap(),
            "io.github.corizhang.onlyping"
        );
        assert_ne!(
            super::credential_service("io.github.corizhang.onlyping.qa").unwrap(),
            "io.github.corizhang.onlyping"
        );
        assert!(super::credential_service("untrusted-service").is_err());
    }
    #[test]
    fn synthetic_credential_roundtrip() {
        // Isolated entry; never read or alter the application's real API key.
        let unique = format!(
            "test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let entry = keyring::Entry::new("io.github.corizhang.onlyping.tests", &unique).unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
        entry.set_password("synthetic-test-value").unwrap();
        let value = entry.get_password();
        let cleanup = entry.delete_credential();
        assert_eq!(value.unwrap(), "synthetic-test-value");
        cleanup.unwrap();
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
}

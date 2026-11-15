fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "read_ai_key",
            "write_ai_key",
            "project_storage_ready",
            "project_storage_migrate",
            "project_storage_save",
            "project_storage_read",
            "project_storage_delete",
            "project_storage_missing_assets",
            "project_storage_list",
        ]),
    ))
    .expect("failed to build application permissions")
}

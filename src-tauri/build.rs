fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["read_ai_key", "write_ai_key"]),
        ),
    )
    .expect("failed to build application permissions")
}

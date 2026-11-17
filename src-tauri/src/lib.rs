#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(image_export::ImageExportState::default())
        .invoke_handler(tauri::generate_handler![
            credentials::read_ai_key,
            credentials::write_ai_key,
            project_storage::project_storage_ready,
            project_storage::project_storage_migrate,
            project_storage::project_storage_save,
            project_storage::project_storage_read,
            project_storage::project_storage_delete,
            project_storage::project_storage_missing_assets,
            project_storage::project_storage_list,
            project_storage::project_storage_location,
            project_storage::project_storage_open_directory,
            project_files::project_file_version,
            project_files::project_file_write,
            workspace::workspace_info,
            workspace::workspace_directory,
            workspace::workspace_save,
            workspace::workspace_remember,
            workspace::workspace_lookup,
            workspace::workspace_open,
            image_export::image_export_begin,
            image_export::image_export_write,
            image_export::image_export_end,
            image_export::image_export_file_location,
            image_export::image_export_open_location
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
mod credentials;
mod project_files;
mod project_storage;
mod image_export;
mod workspace;

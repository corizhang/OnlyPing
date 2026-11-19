#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| { desktop::show(app); }));
    builder
        .manage(app_updates::UpdateState::default())
        .manage(image_export::ImageExportState::default())
        .manage(desktop::DesktopState::default())
        .manage(window_memory::WindowMemory::default())
        .on_window_event(desktop::window_event)
        .invoke_handler(tauri::generate_handler![
            app_updates::app_update_info,
            app_updates::app_update_check,
            app_updates::app_update_download,
            app_updates::app_update_cancel,
            app_updates::app_update_install,
            desktop::desktop_preferences,
            desktop::desktop_save_preferences,
            desktop::desktop_close_action,
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
            workspace::workspace_snapshot,
            workspace::workspace_library_update,
            workspace::workspace_relocate,
            image_export::image_export_begin,
            image_export::image_export_write,
            image_export::image_export_end,
            image_export::image_export_file_location,
            image_export::image_export_open_location
        ])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            desktop::setup(app);
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
mod app_updates;
mod window_memory;
mod desktop;
mod credentials;
mod image_export;
mod project_files;
mod project_storage;
mod workspace;

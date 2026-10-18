#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use sidecar_core::{App, JoinOptions, Meeting};
use std::sync::Arc;
use tauri::{Manager, State};

#[tauri::command]
async fn join_meeting(app: State<'_, Arc<App>>, options: JoinOptions) -> Result<Meeting, String> {
    let app = app.inner().clone();
    tauri::async_runtime::spawn_blocking(move || app.join(options).map_err(|e| format!("{e:#}")))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn leave_meeting(app: State<'_, Arc<App>>, id: String) -> Result<bool, String> {
    let app = app.inner().clone();
    tauri::async_runtime::spawn_blocking(move || app.leave(&id))
        .await
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn list_meetings(app: State<'_, Arc<App>>) -> Vec<Meeting> {
    app.list()
}
#[tauri::command]
fn get_transcript(app: State<'_, Arc<App>>, id: String) -> Option<Meeting> {
    app.transcript(&id)
}
#[tauri::command]
fn audio_devices() -> Result<Vec<String>, String> {
    sidecar_core::audio_devices().map_err(|e| e.to_string())
}

fn main() {
    sidecar_core::load_env();
    tauri::Builder::default()
        .manage(Arc::new(App::default()))
        .invoke_handler(tauri::generate_handler![
            join_meeting,
            leave_meeting,
            list_meetings,
            get_transcript,
            audio_devices
        ])
        .build(tauri::generate_context!())
        .expect("Cannot start Sidecar Meet")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<Arc<App>>().shutdown();
            }
        });
}

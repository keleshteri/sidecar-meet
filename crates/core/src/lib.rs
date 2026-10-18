mod audio;
mod meeting;

pub use audio::{audio_devices, transcribe_wav};
pub use meeting::{App, JoinOptions, Meeting, Segment};

pub fn load_env() {
    let root = std::env::var_os("SIDECAR_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
    let _ = dotenvy::from_path(root.join(".env"));
}

pub fn home() -> std::path::PathBuf {
    std::env::var_os("SIDECAR_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

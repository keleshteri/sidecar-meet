use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use headless_chrome::{Browser, LaunchOptions};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    ffi::OsStr,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JoinOptions {
    pub meeting_url: String,
    pub audio_file_path: Option<PathBuf>,
    pub chrome_profile_path: Option<PathBuf>,
    #[serde(default)]
    pub headless: bool,
    pub stay_duration_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub text: String,
    pub started_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub id: String,
    pub meeting_url: String,
    pub started_at: DateTime<Utc>,
    pub status: String,
    pub listener_status: String,
    pub listener_error: Option<String>,
    pub segments: Vec<Segment>,
}

struct Session {
    meeting: Arc<Mutex<Meeting>>,
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

#[derive(Default)]
pub struct App {
    sessions: Mutex<HashMap<String, Session>>,
    // A shared Chrome profile and audio cable permit only one live meeting.
    busy: Arc<AtomicBool>,
}

struct BusyGuard(Arc<AtomicBool>);
impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn validate(options: &JoinOptions) -> Result<()> {
    let url = url::Url::parse(&options.meeting_url).context("Enter a valid Google Meet URL")?;
    if url.scheme() != "https"
        || url.host_str() != Some("meet.google.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        bail!("Only https://meet.google.com meeting URLs are supported");
    }
    if options.headless {
        bail!("Manual joining needs a visible browser; headless must be false");
    }
    if options
        .stay_duration_ms
        .is_some_and(|ms| !(1000..=86_400_000).contains(&ms))
    {
        bail!("stayDurationMs must be between 1000 and 86400000");
    }
    if let Some(file) = &options.audio_file_path
        && !file.is_file()
    {
        bail!("Audio file does not exist: {}", file.display());
    }
    Ok(())
}

impl App {
    pub fn join(&self, options: JoinOptions) -> Result<Meeting> {
        validate(&options)?;
        if self
            .busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            bail!("A meeting is already running or starting. Leave it first.");
        }
        let busy = BusyGuard(self.busy.clone());
        let id = format!("bot_{}", uuid::Uuid::new_v4());
        let meeting = Arc::new(Mutex::new(Meeting {
            id: id.clone(),
            meeting_url: options.meeting_url.clone(),
            started_at: Utc::now(),
            status: "opening".into(),
            listener_status: "starting".into(),
            listener_error: None,
            segments: vec![],
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let state = meeting.clone();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let worker = thread::spawn(move || {
            let _busy = busy;
            let result = (|| -> Result<()> {
                let profile = options
                    .chrome_profile_path
                    .unwrap_or_else(|| crate::home().join(".auth/chrome-profile"));
                std::fs::create_dir_all(&profile)?;
                let audio_arg = options
                    .audio_file_path
                    .map(|p| {
                        p.canonicalize()
                            .map(|p| format!("--use-file-for-fake-audio-capture={}", p.display()))
                    })
                    .transpose()?;
                let mut args = vec![OsStr::new("--autoplay-policy=no-user-gesture-required")];
                if let Some(audio_arg) = &audio_arg {
                    args.extend([
                        OsStr::new("--use-fake-ui-for-media-stream"),
                        OsStr::new("--use-fake-device-for-media-stream"),
                        OsStr::new(audio_arg),
                    ]);
                }
                let browser = Browser::new(LaunchOptions {
                    headless: false, sandbox: true, enable_gpu: true,
                    ignore_certificate_errors: false,
                    user_data_dir: Some(profile),
                    path: std::env::var_os("CHROME_PATH").map(PathBuf::from),
                    args, idle_browser_timeout: Duration::from_secs(86400),
                    ..Default::default()
                }).context("Cannot launch Chrome. Install Chrome and close any browser using the bot profile.")?;
                let tab = browser.new_tab()?;
                tab.navigate_to(&options.meeting_url)?;
                // API success means the pre-join browser opened, not that Meet admitted the bot.
                state.lock().unwrap().status = "awaiting_manual_join".into();
                let listener = match crate::audio::start(state.clone()) {
                    Ok(listener) => Some(listener),
                    Err(error) => {
                        let mut m = state.lock().unwrap();
                        m.listener_status = "error".into();
                        m.listener_error = Some(format!("{error:#}"));
                        None
                    }
                };
                let _ = tx.send(Ok(()));
                let deadline = Instant::now()
                    + Duration::from_millis(options.stay_duration_ms.unwrap_or(300_000));
                while !stopped.load(Ordering::Relaxed) && Instant::now() < deadline {
                    // A closed tab/browser must also stop audio capture.
                    match tab.evaluate("Boolean(document.querySelector('[aria-label*=\"Leave call\"], [aria-label*=\"Quitter\"]'))", false) {
                        Ok(value) => { if value.value == Some(serde_json::Value::Bool(true)) { state.lock().unwrap().status = "in_call".into(); } },
                        Err(_) => break,
                    }
                    thread::sleep(Duration::from_millis(500));
                }
                state.lock().unwrap().status = "stopping".into();
                drop(browser);
                drop(listener);
                state.lock().unwrap().status = "left".into();
                Ok(())
            })();
            if let Err(error) = result {
                let message = format!("{error:#}");
                let mut m = state.lock().unwrap();
                m.status = "error".into();
                m.listener_error = Some(message.clone());
                let _ = tx.send(Err(message));
            }
        });
        match rx.recv() {
            Ok(Ok(())) => {
                let snapshot = meeting.lock().unwrap().clone();
                self.sessions.lock().unwrap().insert(
                    id,
                    Session {
                        meeting,
                        stop,
                        worker: Some(worker),
                    },
                );
                Ok(snapshot)
            }
            Ok(Err(message)) => {
                let _ = worker.join();
                bail!("{message}");
            }
            Err(error) => {
                let _ = worker.join();
                bail!("Browser worker ended unexpectedly: {error}");
            }
        }
    }

    pub fn list(&self) -> Vec<Meeting> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .filter_map(|s| {
                let m = s.meeting.lock().unwrap();
                (!matches!(m.status.as_str(), "left" | "error")).then(|| m.clone())
            })
            .collect()
    }

    pub fn transcript(&self, id: &str) -> Option<Meeting> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .map(|s| s.meeting.lock().unwrap().clone())
    }

    pub fn leave(&self, id: &str) -> bool {
        let worker = {
            let mut sessions = self.sessions.lock().unwrap();
            let Some(session) = sessions.get_mut(id) else {
                return false;
            };
            session.stop.store(true, Ordering::Relaxed);
            session.worker.take()
        };
        if let Some(worker) = worker {
            let _ = worker.join();
        }
        true
    }

    pub fn shutdown(&self) {
        let ids: Vec<_> = self.sessions.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.leave(&id);
        }
    }
}

impl Drop for App {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn options(url: &str) -> JoinOptions {
        JoinOptions {
            meeting_url: url.into(),
            audio_file_path: None,
            chrome_profile_path: None,
            headless: false,
            stay_duration_ms: None,
        }
    }
    #[test]
    fn only_accepts_google_meet_https() {
        for url in [
            "file:///C:/secret",
            "http://meet.google.com/abc",
            "https://meet.google.com.evil.com/a",
            "https://user@meet.google.com/a",
        ] {
            assert!(validate(&options(url)).is_err(), "{url}");
        }
        assert!(validate(&options("https://meet.google.com/abc-defg-hij")).is_ok());
    }
    #[test]
    fn rejects_headless_manual_join() {
        let mut o = options("https://meet.google.com/a");
        o.headless = true;
        assert!(validate(&o).is_err());
    }
    #[test]
    fn rejects_bad_duration() {
        let mut o = options("https://meet.google.com/a");
        o.stay_duration_ms = Some(0);
        assert!(validate(&o).is_err());
    }
    #[test]
    fn unknown_session_is_not_found() {
        let app = App::default();
        assert!(app.list().is_empty());
        assert!(app.transcript("unknown").is_none());
        assert!(!app.leave("unknown"));
    }
    #[test]
    fn rejects_a_second_meeting_without_launching_chrome() {
        let app = App::default();
        app.busy.store(true, Ordering::Release);
        let error = app.join(options("https://meet.google.com/a")).unwrap_err();
        assert!(error.to_string().contains("already running"));
    }
    #[test]
    fn shutdown_waits_for_worker_and_preserves_transcript() {
        let app = App::default();
        let meeting = Arc::new(Mutex::new(Meeting {
            id: "test".into(),
            meeting_url: "https://meet.google.com/a".into(),
            started_at: Utc::now(),
            status: "in_call".into(),
            listener_status: "listening".into(),
            listener_error: None,
            segments: vec![Segment {
                text: "Saved speech".into(),
                started_at: Utc::now(),
            }],
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let worker_meeting = meeting.clone();
        let worker = thread::spawn(move || {
            while !worker_stop.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_millis(1));
            }
            worker_meeting.lock().unwrap().status = "left".into();
        });
        app.sessions.lock().unwrap().insert(
            "test".into(),
            Session {
                meeting,
                stop,
                worker: Some(worker),
            },
        );
        app.shutdown();
        assert!(app.list().is_empty());
        assert_eq!(
            app.transcript("test").unwrap().segments[0].text,
            "Saved speech"
        );
        app.shutdown(); // Repeated cleanup must be safe.
    }
}

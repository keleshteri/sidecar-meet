use crate::meeting::{Meeting, Segment};
use anyhow::{Context, Result, bail};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
    mpsc,
};
use std::thread;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub fn audio_devices() -> Result<Vec<String>> {
    cpal::default_host()
        .input_devices()?
        .map(|d| d.name().map_err(Into::into))
        .collect()
}

fn context(path: &str) -> Result<WhisperContext> {
    if !std::path::Path::new(path).is_file() {
        bail!(
            "Whisper model not found: {path}. Set WHISPER_MODEL_PATH to a whisper.cpp GGML model."
        );
    }
    let mut params = WhisperContextParameters::default();
    params.use_gpu(false);
    WhisperContext::new_with_params(path, params).context("Cannot load Whisper model")
}

fn infer(ctx: &WhisperContext, samples: &[f32]) -> Result<String> {
    if samples.len() < 1600
        || samples.iter().map(|v| v * v).sum::<f32>() / (samples.len() as f32) < 0.00001
    {
        return Ok(String::new());
    }
    let mut state = ctx.create_state()?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    state.full(params, samples)?;
    Ok(state
        .as_iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>()
        .join("")
        .trim()
        .to_owned())
}

// Downmix and resample each buffered window to Whisper's 16 kHz mono input.
fn resample(data: &[f32], channels: usize, rate: u32) -> Vec<f32> {
    let mono: Vec<f32> = data
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect();
    let length = mono.len() * 16000 / rate as usize;
    (0..length)
        .map(|i| {
            let pos = i as f64 * rate as f64 / 16000.0;
            let at = pos as usize;
            let fraction = (pos - at as f64) as f32;
            let a = mono[at];
            let b = mono.get(at + 1).copied().unwrap_or(a);
            a + (b - a) * fraction
        })
        .collect()
}

pub struct Listener {
    stop: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Drop for Listener {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn set_error(meeting: &Arc<Mutex<Meeting>>, error: String) {
    let mut m = meeting.lock().unwrap();
    m.listener_status = "error".into();
    m.listener_error = Some(error);
}

pub fn start(meeting: Arc<Mutex<Meeting>>) -> Result<Listener> {
    let model = std::env::var("WHISPER_MODEL_PATH").unwrap_or_else(|_| {
        crate::home()
            .join("models/ggml-tiny.en.bin")
            .to_string_lossy()
            .into_owned()
    });
    let model = if std::path::Path::new(&model).is_absolute() {
        model
    } else {
        crate::home().join(model).to_string_lossy().into_owned()
    };
    let device_name = std::env::var("LISTENER_AUDIO_DEVICE")
        .unwrap_or_else(|_| "CABLE Output (VB-Audio Virtual Cable)".into());
    let chunk_seconds = std::env::var("WHISPER_CHUNK_SECONDS")
        .unwrap_or_else(|_| "8".into())
        .parse::<usize>()?;
    if !(1..=30).contains(&chunk_seconds) {
        bail!("WHISPER_CHUNK_SECONDS must be between 1 and 30");
    }
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    let worker = thread::spawn(move || {
        let result = (|| -> Result<()> {
            let host = cpal::default_host();
            let device = host
                .input_devices()?
                .find(|d| d.name().is_ok_and(|n| n == device_name))
                .with_context(|| format!("Audio input '{device_name}' is not available"))?;
            let config = device.default_input_config()?;
            let channels = config.channels() as usize;
            let rate = config.sample_rate().0;
            let window = rate as usize * channels * chunk_seconds;
            let ctx = context(&model)?;
            if stopped.load(Ordering::Relaxed) {
                return Ok(());
            }
            let (tx, rx) = mpsc::sync_channel::<Vec<f32>>(4);
            let errors = meeting.clone();
            let stream_errors =
                move |err| set_error(&errors, format!("Audio capture failed: {err}"));
            let drops = Arc::new(AtomicBool::new(false));
            let overflow = drops.clone();
            let pending = Arc::new(Mutex::new(Vec::with_capacity(window)));
            let capture_buffer = pending.clone();
            let consume = move |samples: Vec<f32>| {
                let mut buffer = capture_buffer.lock().unwrap();
                buffer.extend(samples);
                while buffer.len() >= window {
                    let tail = buffer.split_off(window);
                    let chunk = std::mem::replace(&mut *buffer, tail);
                    if tx.try_send(chunk).is_err() {
                        overflow.store(true, Ordering::Relaxed);
                    }
                }
            };
            let stream = match config.sample_format() {
                cpal::SampleFormat::F32 => device.build_input_stream(
                    &config.clone().into(),
                    move |data: &[f32], _| consume(data.to_vec()),
                    stream_errors,
                    None,
                )?,
                cpal::SampleFormat::I16 => device.build_input_stream(
                    &config.clone().into(),
                    move |data: &[i16], _| {
                        consume(data.iter().map(|v| *v as f32 / 32768.0).collect())
                    },
                    stream_errors,
                    None,
                )?,
                cpal::SampleFormat::U16 => device.build_input_stream(
                    &config.clone().into(),
                    move |data: &[u16], _| {
                        consume(
                            data.iter()
                                .map(|v| (*v as f32 - 32768.0) / 32768.0)
                                .collect(),
                        )
                    },
                    stream_errors,
                    None,
                )?,
                format => bail!("Unsupported audio format: {format:?}"),
            };
            stream.play()?;
            meeting.lock().unwrap().listener_status = "listening".into();
            while !stopped.load(Ordering::Relaxed) {
                if drops.swap(false, Ordering::Relaxed) {
                    set_error(
                        &meeting,
                        "Transcription cannot keep up; audio was dropped. Try a smaller model."
                            .into(),
                    );
                }
                match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(data) => {
                        let text = infer(&ctx, &resample(&data, channels, rate))?;
                        if !text.is_empty() {
                            meeting.lock().unwrap().segments.push(Segment {
                                text,
                                started_at: chrono::Utc::now(),
                            });
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(_) => break,
                }
            }
            drop(stream);
            // Preserve queued speech and the last partial window when leaving.
            for data in rx.try_iter().chain(std::iter::once(std::mem::take(
                &mut *pending.lock().unwrap(),
            ))) {
                let text = infer(&ctx, &resample(&data, channels, rate))?;
                if !text.is_empty() {
                    meeting.lock().unwrap().segments.push(Segment {
                        text,
                        started_at: chrono::Utc::now(),
                    });
                }
            }
            Ok(())
        })();
        match result {
            Err(err) => set_error(&meeting, format!("{err:#}")),
            Ok(()) => {
                meeting.lock().unwrap().listener_status = "stopped".into();
            }
        }
    });
    Ok(Listener {
        stop,
        worker: Some(worker),
    })
}

pub fn transcribe_wav(model: &str, file: &str) -> Result<String> {
    let mut reader = hound::WavReader::open(file)?;
    let spec = reader.spec();
    if spec.sample_format != hound::SampleFormat::Int || spec.bits_per_sample != 16 {
        bail!("Use a 16-bit PCM WAV file");
    }
    let data: Vec<f32> = reader
        .samples::<i16>()
        .map(|v| v.map(|v| v as f32 / 32768.0))
        .collect::<std::result::Result<_, _>>()?;
    let ctx = context(model)?;
    infer(
        &ctx,
        &resample(&data, spec.channels as usize, spec.sample_rate),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resampling_preserves_duration_and_downmixes() {
        let data: Vec<f32> = (0..48000).flat_map(|_| [0.25, 0.75]).collect();
        let output = resample(&data, 2, 48000);
        assert_eq!(output.len(), 16000);
        assert!(output.iter().all(|v| (*v - 0.5).abs() < 0.0001));
    }
    #[test]
    fn missing_model_has_actionable_error() {
        assert!(
            context("missing-model.bin")
                .err()
                .unwrap()
                .to_string()
                .contains("WHISPER_MODEL_PATH")
        );
    }
}

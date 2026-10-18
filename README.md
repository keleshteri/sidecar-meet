# Sidecar Meet — Rust + Tauri

A local meeting assistant with a Rust backend and a Tauri desktop shell. Axum provides an optional HTTP API, Chrome DevTools Protocol controls the meeting browser, CPAL captures native audio, and whisper.cpp transcribes locally through `whisper-rs`.

No Node.js, NestJS, Playwright, FFmpeg, or Python runtime is needed. The desktop interface uses plain HTML/CSS/JavaScript; application logic runs in Rust. Pre-migration source and working-tree changes are preserved in [`legacy/node`](legacy/node).

## Run on Windows

Prerequisites: Rust stable MSVC (1.90+), Visual Studio C++ build tools with CMake and a Windows SDK, Google Chrome, and WebView2. Meeting audio requires a virtual audio cable.

```powershell
# One-time build dependency and English Whisper model (~75 MiB).
powershell -ExecutionPolicy Bypass -File scripts/setup-build-tools.ps1
powershell -ExecutionPolicy Bypass -File scripts/download-model.ps1

# Desktop application.
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1 desktop
```

The launcher discovers Visual Studio's CMake and the local libclang DLL. The first build takes several minutes. If CMake and LIBCLANG_PATH are already configured, `cargo run -p sidecar-desktop` also works.

Optional settings are in [`.env.example`](.env.example). Existing `.env` files are preserved. The old WHISPER_MODEL_ID, WHISPER_DTYPE, WHISPER_DEVICE, BOT_AUTO_JOIN, and BOT_AUDIO_OUTPUT_DEVICE settings are ignored. Set WHISPER_MODEL_PATH for another whisper.cpp GGML model; Node's ONNX models are not compatible.

## Test a meeting

1. Paste a Google Meet URL and click **Open meeting**.
2. Join manually in Chrome. Keep camera and microphone off for listening only. The existing `.auth/chrome-profile` is reused, but its login may have expired.
3. In Meet audio settings, choose **CABLE Input** as the speaker. Under **Audio setup** in Sidecar, verify **CABLE Output (VB-Audio Virtual Cable)** is present. The app does not change Windows' default output.
4. Have another participant speak, preferably from a second device. Text appears after an 8-second window plus inference time; initial model loading adds a delay.
5. Click **Leave meeting**. The browser and capture stop, then queued/partial audio finishes transcription. Text remains until the app exits; **Copy text** exports it to the clipboard.

Only one session runs at a time. Sessions auto-leave after five minutes. `awaiting_manual_join` means Chrome opened, not that Meet admitted the bot. The `in_call` indicator uses best-effort DOM detection.

## API and verification

The API is an alternative host. Run either the desktop or the API at a time because both share the profile and cable. The desktop uses Tauri IPC without an HTTP server.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1 api
```

From another terminal:

```powershell
Invoke-RestMethod http://localhost:4343/health
Invoke-RestMethod http://localhost:4343/audio/devices
$body = @{ meetingUrl = 'https://meet.google.com/YOUR-CODE' } | ConvertTo-Json
$bot = Invoke-RestMethod http://localhost:4343/meetings/join -Method Post -ContentType 'application/json' -Body $body
Invoke-RestMethod http://localhost:4343/meetings
Invoke-RestMethod "http://localhost:4343/meetings/$($bot.id)/transcript" | ConvertTo-Json -Depth 5
Invoke-RestMethod "http://localhost:4343/meetings/$($bot.id)" -Method Delete
```

The API binds to 127.0.0.1. Join accepts `meetingUrl`, optional `chromeProfilePath`, optional `audioFilePath`, and optional `stayDurationMs` (1 second–24 hours). Only HTTPS Google Meet URLs are accepted. `headless: true` and legacy Playwright `storageStatePath` are unsupported; use a visible browser and a Chrome profile.

An explicit `audioFilePath` enables a fake microphone for outgoing-audio tests. This can hide real Chrome output devices, so leave it unset for normal listening. Automatic hello playback and automatic join clicks are not enabled.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1 test
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1 check
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1 build

# Real CPU transcription without a meeting or cable, after building:
.\target\debug\sidecar-api.exe transcribe models/ggml-tiny.en.bin assets/hello.wav
```

Tests cover URL validation, lifecycle lookup, audio conversion, model errors, and HTTP routes. Passing tests do not prove Meet admission or physical audio routing; those need the live test above.

## Layout and limitations

- `crates/core`: shared browser, meeting lifecycle, audio, and transcription.
- `crates/api`: Axum REST host, retaining the main previous endpoint paths.
- `apps/desktop`: Tauri shell and embedded interface.
- `scripts`: Windows setup and run commands.
- `legacy/node`: archived source, excluded from Cargo builds.

Transcription is English on CPU. Calendar integration, Obsidian/RAG, AI replies, TTS, persistent transcript storage, and installer packaging remain future work. Slow inference uses a bounded queue and reports dropped audio. Input resampling is linear; production audio quality may benefit from a band-limited resampler.

This is a local development build. For a copied executable, set SIDECAR_HOME to a persistent directory containing `.env`, `models`, and `.auth`. Historic phase docs describe the Node implementation and do not establish Rust feature parity.

### Verification on this machine

The Rust workspace builds, the API opens/closes Chrome and retains transcript records, and CPU Whisper correctly transcribes the upstream JFK speech sample. The virtual audio cable is currently absent, so live remote-audio capture remains unverified.

Windows blocked the newly built desktop executable with an Application Control error. Code Integrity event 3077 reports that it did not meet enterprise signing requirements. Native desktop startup therefore remains unverified; the UI was checked in a browser preview. A policy-approved signing/deployment path is needed to run the desktop here. No Windows security policy was changed.

# Phase 2 — Listener (Speech-to-Text)

**Status:** verified working locally (CPU inference via
`@huggingface/transformers`, VB-Cable installed) on this Ryzen 5 + RTX 3050
Windows machine, including a full join → capture → transcribe → stop cycle.
Not yet verified against a real multi-party call with someone actually
talking — the audio-output routing that feeds meeting audio to the cable
(`phase-1-bot-engine-api.md`'s "Audio output routing") hasn't been exercised
against real remote audio yet. See "Setup" below.

## Objective

The bot can hear the meeting and produce a text transcript.

## Scope

- `packages/listener`
  - `startListening({ botId, audioDevice?, whisperModelId?, whisperDtype?, whisperDevice?, chunkSeconds? })` —
    spawns `ffmpeg` against the virtual audio cable's recording device to
    get raw 16kHz mono PCM, buffers it into fixed-length windows
    (`chunkSeconds`, default 8s), and runs each window through a whisper
    model loaded in-process via `@huggingface/transformers` (ONNX Runtime)
    as it fills. Resulting text is appended to an in-memory session keyed
    by `botId`.
  - `stopListening(botId)` — tears down the ffmpeg process, flushes any
    partial chunk through the model one last time. Already-collected
    segments stay readable afterward.
  - `getTranscript(botId)` — returns the segments collected so far (or
    `undefined` if no session exists for that id).
- `apps/api` (Nest.js)
  - `POST /meetings/join` now also starts the listener for the new bot
    (best-effort — a listener failure doesn't fail the join itself, since the
    bot already made it into the meeting).
  - `DELETE /meetings/:id` now also stops the listener for that bot.
  - `GET /meetings/:id/transcript` — returns `{ id, segments }`.

## Why this shape

- **Virtual audio cable, not in-browser tab capture.** The bot already fights
  Meet's anti-automation detection to get into a call at all (see
  `phase-1-bot-engine-api.md`'s "Anti-automation detection" section);
  injecting a tab-capture extension or scripting `getDisplayMedia` would add
  more automation surface for platforms to fingerprint, and doesn't
  generalize across Meet/Zoom/Teams. Reading whatever's audible off a
  system-level virtual cable does, uniformly, regardless of which platform
  the bot joined.
- **ffmpeg via `ffmpeg-static`, not a native Node audio addon** (e.g.
  `naudiodon`). Avoids `node-gyp` native compilation, which is the more
  common source of "works on my machine" breakage for this kind of thing.
  `ffmpeg-static` bundles a platform binary, so the only manual system
  install left is the virtual cable itself.
- **Local whisper, not a cloud STT API (Deepgram/Whisper API).** Chosen
  deliberately over a cloud vendor: $0 marginal cost, audio never leaves the
  machine, and — the thing that actually made this viable — nothing
  downstream needs sub-second "live voice agent" latency. The transcript
  just needs to be *readable*, and Phase 4's RAG/reply step consumes it after
  the fact, not mid-sentence. That means the few-seconds-per-chunk lag of
  local batch transcription (vs. Deepgram's sub-300ms streaming) is a cost
  worth paying to drop the vendor, the API key, and the per-minute billing
  entirely. If a future phase genuinely needs sub-second turnaround (e.g. a
  live spoken-back voice agent), that's the point to revisit this — see
  `phase-4-local-brain.md`.
- **`@huggingface/transformers` (in-process, via ONNX Runtime), not a
  spawned `whisper.cpp` binary.** The original plan was to spawn a
  manually-downloaded prebuilt `whisper.cpp` release binary per chunk (same
  pattern as `ffmpeg-static`). That was implemented and worked on paper, but
  failed on this actual machine: Windows **Smart App Control** blocks
  unsigned binaries by reputation, and `whisper.cpp`'s release
  binaries/DLLs aren't signed or reputable enough to pass (Code Integrity
  event 3077, "did not meet the Enterprise signing level requirements") —
  confirmed via `Get-AuthenticodeSignature` and the CodeIntegrity event log,
  and this blocked *both* the CUDA and CPU-only release builds. Turning off
  Smart App Control isn't reversible once it's fully "On" (Microsoft only
  supports disabling it during its initial "Evaluation" window), so that
  wasn't an acceptable fix. `@huggingface/transformers` sidesteps the whole
  problem: it runs whisper via `onnxruntime-node`, whose bundled
  `.dll`/`.node` files are Microsoft-signed (verified — same
  `Get-AuthenticodeSignature` check passes cleanly), and the model itself
  loads as data, not as a new PE binary Windows has to trust. It also drops
  the entire manual-download-and-configure-a-binary-path setup step: the
  model is fetched from the Hugging Face Hub and cached automatically on
  first use.
  - GPU offload via ONNX Runtime's DirectML execution provider
    (`device: 'dml'`) was tried and **segfaulted** on this
    onnxruntime-node/model combination — not pursued further. CPU inference
    with `Xenova/whisper-small` (`dtype: 'q8'`) measured ~4s to transcribe
    ~11s of audio (comfortably faster than real-time), so CPU-only is the
    current default. Revisit `dml` only if chunk latency becomes a real
    problem — see "Notes / gotchas".
- **Lives in its own package (`listener`), not inside `bot-engine`.** Per
  `docs/roadmap.md`'s ground rule, Phase 2+ audio/LLM code stays out of
  `apps/api` controllers, routed through `bot-engine` *or a new
  `packages/*` module*. Audio capture and STT is a distinct concern from
  Playwright browser automation, so it's a sibling package rather than more
  surface area inside `bot-engine`.

## Depends on

Phase 1's bot session lifecycle (a running bot to attach the listener to).

## Setup

1. **Install a virtual audio cable** — [VB-Cable](https://vb-audio.com/Cable/)
   (free) is the simplest option. Install it — **no need to set it as your
   Windows default playback or recording device.** Both sides are addressed
   explicitly instead:
   - `ffmpeg` opens the recording side ("CABLE Output") by exact DirectShow
     device name (`LISTENER_AUDIO_DEVICE` in `.env`), independent of
     whatever Windows considers the default recording device.
   - `bot-engine` routes the meeting's own audio to the playback side
     ("CABLE Input") via `setSinkId()` on the meeting page's own
     `<audio>`/`<video>` elements (`BOT_AUDIO_OUTPUT_DEVICE` in `.env`) —
     see `phase-1-bot-engine-api.md`'s "Audio output routing" section.
   - Net effect: your normal speakers/mic keep working exactly as before,
     for every other app, while the bot is running.
   - If ffmpeg can't find the expected device name, list what's available:
     `ffmpeg -list_devices true -f dshow -i dummy`, and set
     `LISTENER_AUDIO_DEVICE` in `.env` to match exactly.
2. Copy `.env.example` (repo root) to `.env` if you haven't already. The
   `WHISPER_*` defaults (model `Xenova/whisper-small`, `q8` quantization,
   `cpu` device) work with zero further setup — no binary or model file to
   download by hand. The first `POST /meetings/join` (or any pipeline load)
   after a fresh install will download and cache the model from the
   Hugging Face Hub, which takes a bit longer than subsequent runs.

## Running it

```bash
npm install                 # from repo root, installs all workspaces
npm run dev:api              # starts the Nest API on http://localhost:4343
```

```bash
curl -X POST http://localhost:4343/meetings/join \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "https://meet.google.com/xxx-yyyy-zzz"}'

curl http://localhost:4343/meetings/<id>/transcript
```

## Explicitly out of scope for Phase 2

- Any platform other than whatever's already audible via the OS — this
  doesn't distinguish speakers within the meeting, just captures the mixed
  output.
- Persisting transcripts anywhere durable (SQLite, etc.) — in-memory only,
  same as Phase 1's bot session tracking; lost on an API restart.
- True continuous/interim streaming — transcript segments land in
  `chunkSeconds`-sized batches, not word-by-word.

## Done when

- With VB-Cable installed (no default-device changes needed), and a real
  person talking in a joined Meet call, `GET /meetings/:id/transcript`
  returns their words as text within roughly one `chunkSeconds` window.
- `DELETE /meetings/:id` stops the listener cleanly (no orphaned ffmpeg
  process) and the transcript already collected is still readable via the
  same endpoint afterward.

## Notes / gotchas

- **Don't reintroduce a spawned whisper.cpp binary on this machine.**
  Windows Smart App Control blocks it by reputation (see "Why this shape"
  above) — confirmed for both the CUDA and CPU-only release builds. If a
  future change needs raw `whisper.cpp` again (e.g. for a feature ONNX
  Runtime doesn't support), that reputation block is the first thing to
  check, not a red herring.
- The whisper pipeline loads once per process (module-level singleton in
  `transcriber.ts`), not once per bot session, and all chunks across every
  active session are queued through it one at a time — deliberate, to avoid
  contending CPU/GPU across concurrent sessions on consumer hardware. If
  multiple bots are listening simultaneously, expect transcripts to lag
  further behind `chunkSeconds` than with a single session.
- `WHISPER_DEVICE=dml` (DirectML GPU offload) segfaulted in testing — don't
  set this without re-verifying it first. CPU is the only confirmed-working
  device on this machine.
- If you want better accuracy than `whisper-small` and CPU headroom allows,
  try `WHISPER_MODEL_ID=Xenova/whisper-medium` — larger model, same `q8`
  dtype, no code change needed. Watch console timing to see whether it
  still comfortably beats `chunkSeconds`.

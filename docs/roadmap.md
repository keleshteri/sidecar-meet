# Roadmap

sidecar-meet is a bot that joins your meetings — on command or automatically from
your calendar — listens, and (from Phase 4 on) responds using an LLM grounded in
your own Obsidian notes.

## Decisions locked in (2026-07-31)

- **Project name:** sidecar-meet
- **Approach:** Plan A (local-first) restructured so Phase 1 is built around a
  real API from day one, not a throwaway script:
  - `packages/bot-engine` — Playwright automation, framework-agnostic, no HTTP
    or Nest code in it. This is the piece that becomes a real background worker
    later (Phase 2+) without a rewrite.
  - `apps/api` — Nest.js, calls into `bot-engine` directly (in-process) for now.
  - Everything runs locally. Hosting it (Docker, a real server) is a possible
    later step, not a requirement — see [`architecture.md`](./architecture.md).
- **Why Nest.js now instead of a plain script:** we want "join a meeting" to be
  an API call (`POST /meetings/join`) from the start, because Phase 3's calendar
  watcher needs to trigger joins the same way a human/manual trigger would.
  Building the API first avoids a rewrite when the calendar watcher shows up.

## Phase table

| # | Phase | Status | Objective |
|---|-------|--------|-----------|
| 1 | [Bot Engine + API](./phases/phase-1-bot-engine-api.md) | **Done** | Nest.js API that tells a Playwright worker to join a meeting URL, camera off, plays hello.wav |
| 2 | [Listener](./phases/phase-2-listener.md) | In progress | Captures meeting audio, streams to a live transcript |
| 3 | [Calendar Autojoin](./phases/phase-3-calendar-autojoin.md) | Not started | Watches your calendar, auto-triggers Phase 1's join endpoint when a meeting starts |
| 4 | [Local Brain](./phases/phase-4-local-brain.md) | Not started | RAG over your Obsidian vault + LLM reply, spoken back via TTS |
| 5 | [Desktop Shell](./phases/phase-5-desktop-shell.md) (optional) | Not started | Tray app / GUI in front of the API (Tauri) |
| 6 | [Visual Avatar](./phases/phase-6-visual-avatar.md) (optional) | Not started | Streaming video avatar over the fake webcam |

## Ground rules for later phases

- Don't let Phase 2+ audio/LLM code leak into `apps/api` controllers — route it
  through `bot-engine` (or a new `packages/*` module) the same way Phase 1 does.
  Keeps the option open to run bot-engine as an actual separate worker process
  later without touching the API layer.
- Each phase gets its own doc in `docs/phases/` *before* it's implemented, even
  as a stub. Update status here in `roadmap.md` when a phase starts/finishes.
- Known risk carried across all phases: meeting platforms (Meet/Zoom/Teams) can
  change their DOM or actively detect automation. Treat every platform-specific
  selector as fragile and isolate it in `bot-engine` so it's a one-place fix.

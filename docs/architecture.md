# Architecture

## Layout

```
sidecar-meet/
  apps/
    api/            Nest.js — HTTP layer only. No Playwright/browser code here.
  packages/
    bot-engine/      Playwright automation. Exports joinMeeting/leaveMeeting/listActiveBots.
    listener/        Audio capture + Deepgram STT. Exports startListening/stopListening/getTranscript.
  assets/
    hello.wav        Audio played as the fake microphone on join.
  docs/
```

npm workspaces tie `apps/*` and `packages/*` together (`package.json` at the
root). `apps/api` depends on `@sidecar-meet/bot-engine` as a workspace package.

## Why this split

The Nest app should only ever know "call bot-engine, return the result." All
Playwright-specific logic — launch flags, per-platform selectors (Meet vs Zoom
vs Teams), fake-audio wiring — lives in `bot-engine` and nowhere else. Same
rule for `listener`: all audio-capture and STT logic (ffmpeg, the virtual
cable, the in-process whisper model) lives there, not in `apps/api` — per
the roadmap's ground rule that Phase 2+ audio/LLM code stays out of
controllers.

That buys two things:

1. **Platform fragility is contained.** When Google/Zoom/Microsoft change their
   join-page DOM, the fix is in one package, not scattered across controllers.
2. **The "worker" can become a real worker later without an API rewrite.**
   Today, `BotService.join()` calls `bot-engine`'s `joinMeeting()` in-process —
   simplest thing that works locally. If this ever needs to run multiple
   concurrent bots reliably, or survive an API restart, or run on a different
   machine than the API, the natural next step is: put `bot-engine` behind a
   queue (BullMQ + Redis, or similar) and have a separate worker process
   consume jobs from it. Because the API never talks to Playwright directly,
   that swap only touches `BotService`, not the controllers or bot-engine
   itself.

## State (Phase 1)

Active bots are tracked in an in-memory `Map` inside `bot-engine`. This is
intentionally the simplest possible thing — fine for "one person, one machine,
a handful of bots." It will not survive an API restart and does not scale past
one process. Revisit when Phase 3 (calendar autojoin) needs bots to persist
across restarts — likely a small SQLite/Postgres table at that point, not
before.

## Local-first, hostable-later

Nothing here assumes a server. `apps/api` runs on `localhost` like any other
Nest app. If hosting is ever wanted (multi-user, always-on), the path is
Docker Compose around the same two packages — no architecture change, just
deployment.

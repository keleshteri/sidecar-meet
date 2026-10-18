# sidecar-meet

A bot that joins your meetings — on command or automatically from your
calendar — listens, and eventually responds using an LLM grounded in your own
Obsidian notes.

See [`docs/`](./docs) for the full plan. Currently on **Phase 2: Listener** —
see [`docs/phases/phase-2-listener.md`](./docs/phases/phase-2-listener.md).
Phase 1 (join/leave) is done — see
[`docs/phases/phase-1-bot-engine-api.md`](./docs/phases/phase-1-bot-engine-api.md).

## Quickstart

```bash
npm install
npm run dev:api
```

```bash
curl -X POST http://localhost:4343/meetings/join \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "https://meet.google.com/xxx-yyyy-zzz"}'
```

Live transcript (requires the Phase 2 setup in
[`docs/phases/phase-2-listener.md`](./docs/phases/phase-2-listener.md) — a
virtual audio cable; the whisper model itself downloads and caches
automatically on first use, no manual setup needed):

```bash
curl http://localhost:4343/meetings/<id>/transcript
```

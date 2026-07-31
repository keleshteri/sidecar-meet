# sidecar-meet

A bot that joins your meetings — on command or automatically from your
calendar — listens, and eventually responds using an LLM grounded in your own
Obsidian notes.

See [`docs/`](./docs) for the full plan. Currently on **Phase 1: Bot Engine +
API** — see [`docs/phases/phase-1-bot-engine-api.md`](./docs/phases/phase-1-bot-engine-api.md).

## Quickstart

```bash
npm install
npm run dev:api
```

```bash
curl -X POST http://localhost:3000/meetings/join \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "https://meet.google.com/xxx-yyyy-zzz"}'
```

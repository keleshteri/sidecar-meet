# Phase 5 — Desktop Shell (optional)

**Status:** not started

## Objective

A local GUI in front of the API instead of curl/Postman — tray icon, a "join
now" button with a URL field, a list of active bots, basic settings.

## Likely scope

- Tauri app that's just a thin client over `apps/api`'s REST endpoints
  (`localhost:4343`). No business logic in the desktop shell — it stays a view
  over the API, same as Phase 3's calendar watcher is a caller of the API.

## Depends on

Whichever of Phases 1-4 are done by the time this is worth building — it adds
no new capabilities, just a UI.

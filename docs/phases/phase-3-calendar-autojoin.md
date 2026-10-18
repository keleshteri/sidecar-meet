# Phase 3 — Calendar Autojoin

**Status:** not started

## Objective

The bot joins meetings on its own, based on your calendar, without you calling
the API by hand.

## Likely scope

- OAuth against Google Calendar (and/or Microsoft Graph for Outlook).
- A poller (or push webhook, if the calendar API supports it) that reads
  upcoming events, extracts the meeting URL (Meet/Zoom/Teams link) from the
  event body/location, and schedules a call to Phase 1's `POST /meetings/join`
  a minute or two before start time.
- A way to opt individual events in/out (not every calendar event should get a
  bot — e.g. a `[bot]` tag in the title, or an explicit allow-list).
- Persisting "which events already got a bot" somewhere durable (SQLite is
  probably enough) so a restart doesn't double-join or re-join a finished
  meeting.

## Depends on

Phase 1's join/leave API being stable — this phase is a *caller* of that API,
not a rewrite of it.

## Open questions to resolve when starting this phase

- Google Calendar vs Microsoft 365 vs both — which do you actually use day to
  day?
- Poll vs push: polling is simpler to build locally; push webhooks need a
  publicly reachable endpoint (ties into whether/when this gets hosted).

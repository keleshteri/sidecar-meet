# Phase 6 — Visual Avatar (optional)

**Status:** not started

## Objective

The bot has a face: a real-time streaming avatar fed into the meeting's fake
webcam instead of camera-off.

## Likely scope

- Enable the fake webcam flag in `bot-engine` (currently camera stays off by
  design).
- Feed a real-time streaming video source into it via LivePortrait (local) or
  HeyGen's streaming API (hosted).
- Sync the avatar's mouth/expression to Phase 4's generated speech.

## Depends on

Phase 4 (needs generated speech to sync a face to). This is the most
speculative phase — treat the plan here as a placeholder to revisit, not a
committed design.

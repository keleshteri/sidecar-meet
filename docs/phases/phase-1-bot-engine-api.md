# Phase 1 — Bot Engine + API

**Status: done, with a known caveat on scripted auto-join.** Verified live
against a real Google Meet call (`meet.google.com/pzi-iidp-irf`,
2026-07-31): authenticated, undetected, camera off, bot clicked past the
pre-join screen, clicked the mic-unmute button, and ended up in the call
live/unmuted. All "Done when" criteria met at the time.

Since then (2026-08-02), scripted auto-join (`BOT_AUTO_JOIN=true`, the
default) has been hitting Meet's "you can't join this video call" block on
the same meeting/profile that a human clicking through by hand (manual
mode) gets into fine — see "Behavioral detection" below. **Decision: not
worth blocking on right now.** `BOT_AUTO_JOIN=false` (manual click-through
in the visible browser window) is the accepted day-to-day path until
someone specifically picks the auto-join fix back up — it's a one-line env
var, not a design change, and doesn't block Phase 2+ work since the
listener attaches the same way either way. `.env` on this machine is
already set to `BOT_AUTO_JOIN=false`. Revisit "Behavioral detection"'s
open next-steps whenever unattended auto-join actually becomes necessary
(e.g. Phase 3's calendar autojoin, which can't have a human standing by to
click).

## Objective

An API you can call to make a bot join a meeting: camera off, plays `hello.wav`
as its microphone input, and can be told to leave.

## Scope

- `packages/bot-engine`
  - `joinMeeting({ meetingUrl, audioFilePath?, headless?, stayDurationMs?, chromeProfilePath?, storageStatePath?, audioOutputDevice?, botName?, autoJoin? })` —
    launches Chromium with fake-media flags, navigates to `meetingUrl`, fills
    the guest name prompt if one appears (`botName`, env
    `BOT_DISPLAY_NAME`), and routes the meeting's own audio to
    `audioOutputDevice` (see "Audio output routing" below). Set `autoJoin:
    false` (env `BOT_AUTO_JOIN=false`) to skip the automated join-button/
    mic-unmute clicks and click through by hand instead — a debugging escape
    hatch, not the normal path.
  - `leaveMeeting(botId)` — closes that bot's browser context.
  - `listActiveBots()` — what's currently running.
- `apps/api` (Nest.js)
  - `POST /meetings/join` — body `{ meetingUrl, audioFilePath?, headless?, chromeProfilePath?, storageStatePath? }` →
    starts a bot, returns `{ id, meetingUrl, startedAt }`. (`audioOutputDevice`
    isn't exposed as a request param — it's env-configured via
    `BOT_AUDIO_OUTPUT_DEVICE`, same pattern as the listener's `WHISPER_*`/
    `LISTENER_*` vars.)
  - `DELETE /meetings/:id` — stops that bot.
  - `GET /meetings` — lists active bots.

## Explicitly out of scope for Phase 1

- Handling Zoom/Teams' own join-flow buttons — only Google Meet has been
  exercised against a real meeting so far. `clickJoinButton`/`unmuteMicrophone`
  in `bot-engine` only know Meet's button labels.
- Calendar triggering (Phase 3).
- Any audio *capture* — Phase 1 only injects audio out, doesn't listen (Phase 2).

## Done when

- `POST /meetings/join` with a real Google Meet / Zoom / Teams web link results
  in a visible (or headless) Chromium window sitting in the meeting with camera
  off and `hello.wav` audible as your mic.
- `DELETE /meetings/:id` closes it.
- `GET /meetings` reflects reality.

## Running it

```bash
npm install                 # from repo root, installs all workspaces
npm run dev:api              # starts the Nest API on http://localhost:4343
```

```bash
curl -X POST http://localhost:4343/meetings/join \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "https://meet.google.com/xxx-yyyy-zzz"}'
```

## Authentication

An anonymous Chromium context (no Google login) will not get into most real
meetings — see the gotcha below.

**Signing in *inside* Playwright doesn't work.** Google detects that the
browser is automation-controlled (CDP) and blocks the sign-in form itself with
"Couldn't sign you in — this browser or app may not be secure," regardless of
headless/headed or whether a human is doing the typing. There's no flag that
reliably defeats this — don't spend time trying. The only working approach:
**sign in first in a real, non-automated Chrome, then hand that already-
authenticated session to Playwright.**

Steps, once per Google account you want the bot to use:

1. In your normal desktop Chrome, create a **new, separate profile** dedicated
   to the bot (Chrome menu → profile icon → "Add" — do not reuse your everyday
   profile, since its entire cookie/password/history store gets copied in step
   3, more on that below).
2. In that new profile, sign into the Google account the bot should use.
   Ideally that account is one already invited to the meetings you'll test
   with. Once signed in, fully quit Chrome (all windows, and check no
   `chrome.exe` remains in Task Manager — a running Chrome locks its profile
   directory).
3. Find that profile's folder: open `chrome://version` while the new profile
   is active *before* quitting, and copy the "Profile Path" value shown there
   (on Windows, typically something like
   `%LOCALAPPDATA%\Google\Chrome\User Data\Profile 2`).
4. Import it:
   ```bash
   npm run login:google --workspace packages/bot-engine -- "C:\Users\you\AppData\Local\Google\Chrome\User Data\Profile 2"
   ```
   This copies that profile (skipping cache/lock files) into
   `.auth/chrome-profile` at the repo root. `joinMeeting` picks it up
   automatically — no request params needed.

**Why a dedicated profile, not your main one:** the imported folder contains
everything Chrome stores for that profile — saved passwords, autofill, cookies
for every site you've visited there, history. A profile used only for the bot
account contains only what that account needs; your everyday profile contains
far more than this project has any reason to touch. `.auth/` is gitignored
either way, but treat its contents as credentials.

To point a request at a different imported profile, pass `chromeProfilePath`
in the `POST /meetings/join` body. `storageStatePath` still exists as a
fallback for a pre-exported storageState JSON, but a *fresh* Google login
captured that way will hit the same automation block described above.

## Anti-automation detection

Getting an authenticated profile into the browser isn't the whole story —
confirmed live: even with a real, correctly-authenticated account that could
join the meeting fine from a normal browser tab, Meet still refused entry from
the automated browser with the same "you can't join this video call" message.
Google's Meet-specific bot detection checks the browser itself, independent of
whether the session is authenticated (via CDP-visible traces like
`navigator.webdriver`, forced software WebGL rendering, and similar).

`joinMeeting` mitigates the common signals:

- Drops Playwright's default `--enable-unsafe-swiftshader` (forces a
  software WebGL renderer — a strong, easily-fingerprinted "this is
  automation" signal) and `--no-sandbox` (real users essentially never run
  without a sandbox) via `ignoreDefaultArgs`.
- Injects a script (`context.addInitScript`) patching the common JS-visible
  tells: `navigator.webdriver`, `navigator.plugins`, `navigator.languages`,
  `window.chrome`, and the permissions API's `notifications` check.

**`--disable-blink-features=AutomationControlled` is explicitly dropped via
`ignoreDefaultArgs` — do not remove it from that list.** Confirmed live:
Chrome shows a visible "You are using an unsupported command-line flag:
--disable-blink-features=AutomationControlled. Stability and security will
suffer." banner whenever this flag is set, which is a far more obvious,
trivially-checkable "this is an automated browser" signal than the
`navigator.webdriver` property it's meant to hide (`addInitScript` already
patches that property directly, so the flag was redundant on top of being
counterproductive). The catch: **Playwright adds this flag itself by
default** — it's not something this codebase ever opted into. The fix isn't
"don't add the flag" (it was never explicitly added to `chromeArgs`), it's
"tell Playwright not to add its own default" via `ignoreDefaultArgs`, the
same mechanism already used for `--enable-unsafe-swiftshader`/`--no-sandbox`.
Removing it only from `chromeArgs` (not `ignoreDefaultArgs`) looked like a
fix but changed nothing, and cost a debugging round to notice — Playwright's
default was still injecting it either way.

This is not a guaranteed, permanent fix — Google actively maintains its
detection, and this is the same cat-and-mouse problem commercial meeting-bot
products fight continuously. If joins that used to work start failing again
with the same "can't join" message on an account that can join manually,
suspect detection drifting ahead of these patches before anything else — and
specifically check for any Chrome infobar/warning banner first, since that's
a much stronger tell than the JS-level fingerprints this file otherwise
focuses on.

### Behavioral detection (interaction pattern, not fingerprint)

Confirmed live (2026-08-02): with `BOT_AUTO_JOIN=false`, a human clicking
through the pre-join screen by hand — in the *same* Playwright-launched
browser, same `chromeProfilePath`, same everything above — got in fine.
The scripted `enterGuestName`/`clickJoinButton`/`unmuteMicrophone` flow, on
the identical meeting, got the same "you can't join this video call" block.
Since the browser and session were identical in both cases, the only
difference was *how* the name field and buttons were interacted with —
this is a distinct detection layer from the static fingerprints above.

Playwright's `Locator.fill()` and `Locator.click()` dispatch trusted,
CDP-level input events (not JS-synthetic ones), but the *pattern* is still a
tell: `fill()` sets the whole value in one shot with no real keydown/keypress
events per character, and `click()` teleports the cursor straight to the
element's dead-center with zero travel time and fires immediately on
`domcontentloaded` with no pause. Real users don't do any of that.

Mitigated in `packages/bot-engine/src/index.ts` via `humanClick`/`humanType`
helpers, used in place of `fill()`/`click()` throughout: the mouse moves to a
randomized (non-center) point in the target element over several
interpolated steps, pauses, then presses/releases separately; text is typed
character-by-character via `pressSequentially` with randomized per-key
delay; and a randomized 1-2.5s pause happens after page load before any
interaction starts, plus shorter randomized pauses before each click. No new
dependency — all built on Playwright's own `page.mouse`/`Locator` APIs.

**Not yet re-verified against a real blocked join, and not currently a
priority** — see the Status note at the top of this doc. `humanClick`/
`humanType` are left in place since they're strictly closer to real user
behavior than `fill()`/`click()` regardless, but nobody should burn more
time chasing this until unattended auto-join is actually needed again. When
that day comes, the next things to try, roughly in order: bezier-curved
(not linear) mouse paths, occasional small mouse jitter/overshoot-correct
before landing, and randomizing which UI element gets focused first (e.g. a
stray hover elsewhere) rather than going straight for the name field. If
those still don't work, the calendar-invite trick from the Read.ai/Otter/
Recall.ai research (signed-in bot account added as an actual calendar
guest, so it skips the waiting room) is the more durable lever — see
"Authentication" above and `docs/phases/phase-3-calendar-autojoin.md`.

## Audio output routing

**Verified working end-to-end against a real call** (2026-08-01): joined
`meet.google.com/pzi-iidp-irf`, a human spoke, and the transcript came back
with real transcribed words. The mechanism that actually works is an
OS-wide default-playback-device claim, not per-element `setSinkId()` — read
on for why both exist in the code.

`joinMeeting` claims the playback device matching `audioOutputDevice`
(default `"CABLE Input"`, override via `BOT_AUDIO_OUTPUT_DEVICE`) as the
machine's default *for as long as any bot is active* —
`claimPlaybackDevice`/`releasePlaybackDeviceIfLastBot` in
`packages/bot-engine/src/index.ts`, backed by
`packages/bot-engine/src/audioDevice.ts` shelling out to PowerShell +
the `AudioDeviceCmdlets` module (`Install-Module -Name AudioDeviceCmdlets
-Scope CurrentUser` — must already be installed; there's no other scriptable
way to read/set the Windows default audio device). Reference-counted: the
*first* bot to join remembers what was default before and claims the cable;
the *last* bot to leave restores it. Concurrent bot sessions share the claim
correctly, but do mean your normal speakers are silenced machine-wide for as
long as *any* bot is in a call — see "Why OS-wide, not per-tab" below for
why this couldn't be scoped more tightly.

Separately, `joinMeeting` also calls `routeAudioToDevice(page,
audioOutputDevice)`, which finds every `<audio>`/`<video>` element on the
meeting page (via a `MutationObserver`, catching ones Meet adds later per
remote participant) and attempts `setSinkId()` on each. **This part doesn't
currently work and effectively never fires**: the bot's own device
enumeration only ever sees 3 synthetic "Fake Audio Output" devices (see
below), so it can never find a real match. It's kept in the code as a
harmless best-effort fallback — no-op today, might start working if a future
Chromium/flag change stops faking output enumeration — not as the thing
actually making audio routing work.

### Why OS-wide, not per-tab

Two tighter-scoped alternatives were tried and ruled out before landing on
the OS-wide claim:

- **`setSinkId()` alone** — the obvious "should be scoped to just this tab"
  answer, and the original design. Confirmed broken by adding debug logging
  and checking what `navigator.mediaDevices.enumerateDevices()` actually
  returns inside the bot's page: only `"Fake Default Audio Output"`, `"Fake
  Audio Output 1"`, `"Fake Audio Output 2"` — never the real CABLE Input.
  Cause: `--use-fake-device-for-media-stream` (chromeArgs, required for the
  fake-mic feature via `--use-file-for-fake-audio-capture`) replaces
  Chromium's *entire* audio device manager with synthetic devices for
  testing purposes, not just the capture/input side as the name might
  suggest — it also blinds `enumerateDevices()`'s output listing, with no
  known flag to scope the fakery to input only. Actual audio *rendering*
  turned out to still go through the real OS default device regardless (see
  below), so the meeting audio itself isn't fake — only what the page can
  *see* via JS is.
- **Windows' per-app Volume Mixer preference** (Settings → Sound → App
  volume and device preferences) — ruled out without even trying it, because
  `joinMeeting` launches via `channel: 'chrome'` (your actual installed
  Chrome binary, reused deliberately so it can carry an already-authenticated
  profile past Google's automation block). The bot's Chrome and your
  everyday Chrome share the same OS-level app identity, so a persisted
  per-app device preference could silently redirect your regular browsing
  audio too, not just the bot's.

That leaves the OS-wide default as the only mechanism confirmed to actually
work, which is why it's now automatic and reference-counted rather than a
manual step — automating away the inconvenience since scoping it more
tightly isn't currently possible.

## Notes / gotchas

- `assets/hello.wav` in this repo is a generated 1.2s placeholder tone, not a
  real recording — swap it for an actual "Hello" clip before demoing to anyone.
- `headless: false` (the default) is deliberate for now — you want to see what
  the bot sees while you're still figuring out each platform's join flow.
- **"You can't join this video call... no one can join a meeting unless
  invited or admitted by the host"** — two different causes produce this exact
  message:
  - **Anonymous visitor**: happens before sign-in works at all, when the
    meeting's org doesn't allow un-signed-in guests. Fix: import an
    authenticated Chrome profile (Authentication section above).
  - **Signed in, but still refused**: if the toolbar shows a "Verify it's
    you"-style badge and the URL bar shows the real meeting code, auth is
    working. Two possible causes from here: (a) the account genuinely isn't
    invited/authorized for *that specific* meeting — confirm it can join from
    a normal, non-automated browser tab first — or (b) Google's automation
    detection is still flagging the browser itself even though it's
    authenticated. See "Anti-automation detection" below; this was the actual
    cause the one time this was debugged live.
- **"Couldn't sign you in — this browser or app may not be secure"** — you hit
  this if you try to sign in inside a Playwright-launched browser. It cannot
  be fixed with a flag; sign in outside Playwright instead (Authentication
  section above).
- **`browserType.launchPersistentContext: Timeout 180000ms exceeded`** — the
  imported profile directory is malformed. Chrome needs `Local State` (holds
  encryption-key metadata) sitting *next to* a `Default/` folder containing
  the actual profile files; `login.ts` builds exactly that layout. If you ever
  hand-copy a profile instead of using the script, get this wrong and Chrome
  hangs on startup instead of failing cleanly.
- `clickJoinButton` and `unmuteMicrophone` (in `packages/bot-engine/src/index.ts`)
  are best-effort: if Meet's DOM doesn't match the expected button role/label
  within their timeout, they log a `[bot-engine]` warning and let `joinMeeting`
  continue rather than throwing — a bot that fails to unmute (or never gets
  past pre-join) still shows up as "active" via `GET /meetings`. Check the
  console output to tell the difference between "joined and unmuted" and
  "joined but stuck/muted."

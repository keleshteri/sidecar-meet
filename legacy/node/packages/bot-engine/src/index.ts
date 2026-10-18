import { chromium, BrowserContext, Locator, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { getDefaultPlaybackDeviceId, findPlaybackDeviceIdByLabel, setDefaultPlaybackDeviceId } from './audioDevice';

export interface JoinMeetingOptions {
  /** Full URL of the meeting to join (Google Meet, Zoom web client, Teams web client). */
  meetingUrl: string;
  /** Absolute or project-relative path to a .wav file played as the fake microphone input. */
  audioFilePath?: string;
  /** Run Chromium headless. Keep false while developing so you can see what the bot sees. */
  headless?: boolean;
  /** How long to keep the bot in the meeting before it leaves, in ms. */
  stayDurationMs?: number;
  /**
   * Path to a Chrome user-data directory belonging to a profile that's
   * *already* signed into Google — set up once in real, non-automated
   * Chrome (see docs/phases/phase-1-bot-engine-api.md#authentication).
   * Google blocks sign-in attempted from an automation-controlled browser
   * outright, so the account must already be authenticated before
   * Playwright ever launches it. Defaults to `.auth/chrome-profile` at the
   * repo root if present. Takes priority over storageStatePath.
   */
  chromeProfilePath?: string;
  /**
   * Legacy fallback: a Playwright storageState JSON. Only used when
   * chromeProfilePath isn't set/present. Kept for cases where you already
   * have a valid exported session; a fresh Google sign-in captured this way
   * will hit the same automation block as chromeProfilePath is meant to fix.
   */
  storageStatePath?: string;
  /**
   * Substring (case-insensitive) matched against a playback device's name
   * to find the virtual cable's input side. joinMeeting claims it as the
   * OS-wide default playback device for as long as any bot is active
   * (reference-counted — first join claims it, last leave restores whatever
   * was default before), and also best-effort attempts per-element
   * setSinkId() routing scoped to just the meeting tab. Only the OS-default
   * claim actually works right now: `--use-fake-device-for-media-stream`
   * (needed for the fake mic) blinds the page's own device enumeration to
   * synthetic fake devices, so setSinkId can never find the real one — see
   * "Audio output routing" in phase-1-bot-engine-api.md for the full story
   * and why this couldn't be scoped more tightly than OS-wide. Defaults to
   * process.env.BOT_AUDIO_OUTPUT_DEVICE, then "CABLE Input".
   */
  audioOutputDevice?: string;
  /**
   * Display name filled into Meet's guest "Your name" prompt, which shows
   * up before the join button when joining without an authenticated
   * session (or with one Meet doesn't recognize/trust for that meeting).
   * Best-effort — if no such prompt appears (the expected case with a
   * valid `chromeProfilePath`), this is a no-op. Defaults to
   * process.env.BOT_DISPLAY_NAME, then "Sidecar Notetaker".
   */
  botName?: string;
  /**
   * When false, skips the automated enterGuestName/clickJoinButton/
   * unmuteMicrophone steps entirely — the browser opens on the meeting URL
   * and sits there for a human to click through by hand (works because
   * headless: false shows a real window). Temporary escape hatch for
   * isolating "does automated joining work" from "does everything past
   * joining (audio routing, listener) work" while debugging join failures.
   * Audio-output routing still runs either way. Defaults to
   * process.env.BOT_AUTO_JOIN !== 'false' (i.e. true unless explicitly
   * disabled).
   */
  autoJoin?: boolean;
}

export interface ActiveBot {
  id: string;
  meetingUrl: string;
  context: BrowserContext;
  startedAt: Date;
}

const activeBots = new Map<string, ActiveBot>();

// Reference-counted claim on the OS-wide default playback device: set once
// when the first bot joins (remembering what it replaced), restored once
// the last bot leaves. See audioOutputDevice's doc comment above for why
// this is OS-wide rather than scoped to just the bot's own process/tab.
let claimedPlaybackDeviceId: string | undefined;
let originalPlaybackDeviceId: string | undefined;

async function claimPlaybackDevice(deviceLabelMatch: string): Promise<void> {
  if (activeBots.size > 0) return; // another bot already holds the claim
  const [currentId, targetId] = await Promise.all([
    getDefaultPlaybackDeviceId(),
    findPlaybackDeviceIdByLabel(deviceLabelMatch),
  ]);
  if (!targetId) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bot-engine] Could not find a playback device matching "${deviceLabelMatch}" — meeting audio ` +
        'will not reach the listener. Is the virtual cable installed? Is AudioDeviceCmdlets ' +
        '(Install-Module -Name AudioDeviceCmdlets -Scope CurrentUser) available?',
    );
    return;
  }
  try {
    await setDefaultPlaybackDeviceId(targetId);
    claimedPlaybackDeviceId = targetId;
    originalPlaybackDeviceId = currentId;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bot-engine] Failed to set default playback device: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function releasePlaybackDeviceIfLastBot(): Promise<void> {
  if (activeBots.size > 0 || !claimedPlaybackDeviceId) return; // other bots still active, or nothing to restore
  const restoreId = originalPlaybackDeviceId;
  claimedPlaybackDeviceId = undefined;
  originalPlaybackDeviceId = undefined;
  if (!restoreId) return;
  try {
    await setDefaultPlaybackDeviceId(restoreId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bot-engine] Failed to restore original default playback device: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Launches Chromium with fake media flags and navigates it to a meeting URL.
 * Camera stays off; if an audio file is provided, it's used as the fake microphone.
 */
export async function joinMeeting(options: JoinMeetingOptions): Promise<ActiveBot> {
  const {
    meetingUrl,
    audioFilePath,
    headless = false,
    stayDurationMs = 5 * 60 * 1000,
    chromeProfilePath = defaultChromeProfilePath(),
    storageStatePath = defaultAuthStatePath(),
    audioOutputDevice = process.env.BOT_AUDIO_OUTPUT_DEVICE ?? 'CABLE Input',
    botName = process.env.BOT_DISPLAY_NAME ?? 'Sidecar Notetaker',
    autoJoin = process.env.BOT_AUTO_JOIN !== 'false',
  } = options;

  if (audioFilePath && !fs.existsSync(audioFilePath)) {
    throw new Error(`Audio file not found: ${audioFilePath}`);
  }

  // Must run before this bot is added to activeBots — claimPlaybackDevice
  // uses the current (pre-this-bot) count to decide whether it's the first
  // active bot and therefore responsible for the claim.
  await claimPlaybackDevice(audioOutputDevice);

  const chromeArgs = [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ];
  if (audioFilePath) {
    chromeArgs.push(`--use-file-for-fake-audio-capture=${audioFilePath}`);
  }

  const useProfile = fs.existsSync(chromeProfilePath);
  const useStorageState = !useProfile && fs.existsSync(storageStatePath);

  if (!useProfile && !useStorageState) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bot-engine] No Chrome profile at ${chromeProfilePath} and no saved login at ${storageStatePath} — ` +
        'joining anonymously. Many meetings reject anonymous visitors outright. ' +
        'See docs/phases/phase-1-bot-engine-api.md#authentication.',
    );
  }

  let context: BrowserContext;
  if (useProfile) {
    context = await chromium.launchPersistentContext(chromeProfilePath, {
      headless,
      channel: 'chrome',
      args: chromeArgs,
      // Playwright's own defaults include --enable-unsafe-swiftshader (forces
      // software WebGL rendering — a strong, easily-fingerprinted automation
      // signal), --no-sandbox (real users essentially never run without a
      // sandbox), and --disable-blink-features=AutomationControlled (which,
      // confirmed live, makes Chrome show a visible "unsupported
      // command-line flag" warning banner — a far more obvious automation
      // tell than the navigator.webdriver property it's meant to hide, which
      // addInitScript below already patches directly). Dropping all three
      // makes the browser both harder to fingerprint and closer to a normal
      // Chrome install. Do not remove the third one — see "Anti-automation
      // detection" in docs/phases/phase-1-bot-engine-api.md.
      ignoreDefaultArgs: ['--enable-unsafe-swiftshader', '--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
  } else {
    const browser = await chromium.launch({
      headless,
      args: chromeArgs,
      ignoreDefaultArgs: ['--enable-unsafe-swiftshader', '--no-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    context = await browser.newContext(useStorageState ? { storageState: storageStatePath } : {});
  }

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    // @ts-expect-error - window.chrome is a real, non-standard Chrome global
    window.chrome = window.chrome ?? { runtime: {} };
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(meetingUrl, { waitUntil: 'domcontentloaded' });
  if (autoJoin) {
    // A human doesn't start typing/clicking the instant the DOM loads —
    // acting immediately on domcontentloaded is itself a timing tell.
    await humanPause(1000, 2500);
    await enterGuestName(page, botName);
    await clickJoinButton(page);
    await unmuteMicrophone(page);
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      '[bot-engine] autoJoin disabled (BOT_AUTO_JOIN=false) — waiting for a human to click through ' +
        'the join flow by hand in the visible browser window.',
    );
  }
  await routeAudioToDevice(page, audioOutputDevice);

  const id = `bot_${Date.now()}`;
  const bot: ActiveBot = { id, meetingUrl, context, startedAt: new Date() };
  activeBots.set(id, bot);

  // Auto-leave after stayDurationMs unless something else calls leaveMeeting first.
  setTimeout(() => {
    if (activeBots.has(id)) {
      void leaveMeeting(id);
    }
  }, stayDurationMs);

  return bot;
}

function randomBetween(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

async function humanPause(minMs: number, maxMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, randomBetween(minMs, maxMs)));
}

/**
 * Moves the mouse to a randomized (non-dead-center) point inside the
 * element's bounding box over several interpolated steps, pauses, then
 * presses and releases — instead of Locator.click(), which teleports the
 * cursor straight to center and fires down/up with zero travel time.
 * Confirmed live: Meet let a human click through the exact same pre-join
 * screen (same profile, same browser, same "trusted" CDP-dispatched events)
 * that the scripted fill()/click() flow got hard-blocked on — the
 * difference was interaction *pattern*, not any static fingerprint like
 * navigator.webdriver. See "Anti-automation detection" in
 * phase-1-bot-engine-api.md.
 */
async function humanClick(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) {
    await locator.click();
    return;
  }
  const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
  const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);
  await page.mouse.move(targetX, targetY, { steps: randomBetween(15, 30) });
  await humanPause(80, 250);
  await page.mouse.down();
  await humanPause(40, 120);
  await page.mouse.up();
}

/** Clicks into the field (via humanClick) then types character-by-character
 * with randomized per-key delay via pressSequentially, instead of fill()'s
 * single-shot value set (which fires no real keydown/keypress events —
 * another pattern-level tell alongside instant clicks). */
async function humanType(page: Page, locator: Locator, text: string): Promise<void> {
  await humanClick(page, locator);
  await humanPause(150, 400);
  await locator.pressSequentially(text, { delay: randomBetween(60, 160) });
}

/**
 * Fills Meet's guest "Your name" field when present — shown before the join
 * button when joining without an authenticated session (or with one Meet
 * doesn't recognize/trust for that meeting), which otherwise leaves the bot
 * stuck on the pre-join screen with no way to proceed unattended. Best-
 * effort: if no such field appears within the timeout (the expected case
 * with a valid, still-authenticated chromeProfilePath), this is a no-op —
 * Meet already knows who the bot is from the signed-in session.
 */
async function enterGuestName(page: Page, name: string): Promise<void> {
  const nameInput = page.getByPlaceholder(/your name/i).or(page.getByLabel(/your name/i));
  try {
    await nameInput.first().waitFor({ state: 'visible', timeout: 8_000 });
    await humanType(page, nameInput.first(), name);
  } catch {
    // No guest name prompt — either already authenticated, or Meet's DOM
    // for this doesn't match the expected placeholder/label. Not fatal
    // either way; clickJoinButton's own timeout will surface the latter.
  }
}

/**
 * Google Meet's pre-join screen labels its entry button "Join now" (account
 * already a member of the meeting) or "Ask to join" (needs host approval).
 * Clicks whichever renders first. Best-effort: logs and moves on if neither
 * shows up, since Meet's DOM/copy is fragile and out of our control.
 */
async function clickJoinButton(page: Page): Promise<void> {
  const joinButton = page.getByRole('button', { name: /join now|ask to join/i });
  try {
    await joinButton.first().waitFor({ state: 'visible', timeout: 30_000 });
    await humanPause(300, 900);
    await humanClick(page, joinButton.first());
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      '[bot-engine] Could not find a "Join now"/"Ask to join" button within 30s — ' +
        "Meet's DOM may have changed, or the bot never reached the pre-join screen. " +
        'See docs/phases/phase-1-bot-engine-api.md.',
    );
  }
}

/**
 * Meet joins the bot with its mic muted by default, regardless of the fake
 * audio device being fed hello.wav — nothing is transmitted until the unmute
 * button is clicked. Its aria-label flips between "Turn on microphone"
 * (muted) and "Turn off microphone" (live); this only handles the muted
 * case. Best-effort, same caveats as clickJoinButton.
 */
async function unmuteMicrophone(page: Page): Promise<void> {
  const unmuteButton = page.getByRole('button', { name: /turn on microphone/i });
  try {
    await unmuteButton.waitFor({ state: 'visible', timeout: 20_000 });
    await humanPause(300, 900);
    await humanClick(page, unmuteButton);
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      '[bot-engine] Could not find a muted-microphone toggle within 20s — either the bot ' +
        'joined unmuted already, or the button selector needs updating. ' +
        'See docs/phases/phase-1-bot-engine-api.md.',
    );
  }
}

/**
 * Routes the meeting's audio (remote participants' speech) to a specific
 * output device — the virtual cable's playback side — via each <audio>/
 * <video> element's setSinkId(), instead of relying on the OS-wide default
 * playback device. This is what lets the listener capture meeting audio
 * without claiming the whole machine's default speaker (which would mute
 * every other app). Best-effort, same caveats as clickJoinButton/
 * unmuteMicrophone: Meet's DOM/media plumbing is out of our control and
 * could change, and this hasn't been verified against a real multi-party
 * call (no remote audio to route in solo testing) — if meeting audio isn't
 * reaching the transcript, check the [bot-engine] warnings this logs first.
 */
async function routeAudioToDevice(page: Page, deviceLabelMatch: string): Promise<void> {
  await page.exposeFunction('__sidecarLogAudioRouting', (message: string) => {
    // eslint-disable-next-line no-console
    console.warn(`[bot-engine] audio routing: ${message}`);
  });

  try {
    await page.evaluate((deviceLabelMatch: string) => {
      type SinkableMediaElement = HTMLMediaElement & {
        setSinkId?: (sinkId: string) => Promise<void>;
      };
      const log = (window as unknown as { __sidecarLogAudioRouting: (message: string) => void })
        .__sidecarLogAudioRouting;

      let loggedFailure = false; // one warning per session, not one per <audio> element

      async function findSinkId(): Promise<string | undefined> {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const match = devices.find(
          (d) => d.kind === 'audiooutput' && d.label.toLowerCase().includes(deviceLabelMatch.toLowerCase()),
        );
        return match?.deviceId;
      }

      async function applySink(el: SinkableMediaElement): Promise<void> {
        if (typeof el.setSinkId !== 'function') {
          if (!loggedFailure) {
            loggedFailure = true;
            log('setSinkId unsupported on this media element — relying on the OS-default playback claim instead.');
          }
          return;
        }
        try {
          const sinkId = await findSinkId();
          if (!sinkId) {
            if (!loggedFailure) {
              loggedFailure = true;
              log(
                `No audio-output device matching "${deviceLabelMatch}" visible to the page (expected while ` +
                  '--use-fake-device-for-media-stream is active) — relying on the OS-default playback claim instead.',
              );
            }
            return;
          }
          await el.setSinkId(sinkId);
        } catch (err) {
          if (!loggedFailure) {
            loggedFailure = true;
            log(`setSinkId failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      document.querySelectorAll('audio, video').forEach((el) => void applySink(el as SinkableMediaElement));

      // Meet adds a hidden <audio>/<video> element per remote participant
      // as they join or start speaking — catch those too, not just what's
      // already on the page at routing time.
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof HTMLMediaElement) {
              void applySink(node as SinkableMediaElement);
            } else if (node instanceof Element) {
              node
                .querySelectorAll('audio, video')
                .forEach((el) => void applySink(el as SinkableMediaElement));
            }
          });
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }, deviceLabelMatch);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[bot-engine] Failed to set up audio routing to "${deviceLabelMatch}": ` +
        `${err instanceof Error ? err.message : String(err)}. Meeting audio may not reach the listener.`,
    );
  }
}

export async function leaveMeeting(botId: string): Promise<boolean> {
  const bot = activeBots.get(botId);
  if (!bot) return false;
  await bot.context.close();
  activeBots.delete(botId);
  await releasePlaybackDeviceIfLastBot();
  return true;
}

export function listActiveBots(): Omit<ActiveBot, 'context'>[] {
  return Array.from(activeBots.values()).map(({ context, ...rest }) => rest);
}

export function defaultHelloAudioPath(): string {
  return path.resolve(__dirname, '..', '..', '..', 'assets', 'hello.wav');
}

export function defaultAuthStatePath(): string {
  return path.resolve(__dirname, '..', '..', '..', '.auth', 'google.json');
}

export function defaultChromeProfilePath(): string {
  return path.resolve(__dirname, '..', '..', '..', '.auth', 'chrome-profile');
}

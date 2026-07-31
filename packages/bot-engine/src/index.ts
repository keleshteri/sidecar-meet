import { chromium, Browser } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

export interface JoinMeetingOptions {
  /** Full URL of the meeting to join (Google Meet, Zoom web client, Teams web client). */
  meetingUrl: string;
  /** Absolute or project-relative path to a .wav file played as the fake microphone input. */
  audioFilePath?: string;
  /** Run Chromium headless. Keep false while developing so you can see what the bot sees. */
  headless?: boolean;
  /** How long to keep the bot in the meeting before it leaves, in ms. */
  stayDurationMs?: number;
}

export interface ActiveBot {
  id: string;
  meetingUrl: string;
  browser: Browser;
  startedAt: Date;
}

const activeBots = new Map<string, ActiveBot>();

/**
 * Launches a Chromium instance with fake media flags and navigates it to a meeting URL.
 * Camera stays off; if an audio file is provided, it's used as the fake microphone.
 */
export async function joinMeeting(options: JoinMeetingOptions): Promise<ActiveBot> {
  const {
    meetingUrl,
    audioFilePath,
    headless = false,
    stayDurationMs = 5 * 60 * 1000,
  } = options;

  if (audioFilePath && !fs.existsSync(audioFilePath)) {
    throw new Error(`Audio file not found: ${audioFilePath}`);
  }

  const chromeArgs = [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ];
  if (audioFilePath) {
    chromeArgs.push(`--use-file-for-fake-audio-capture=${audioFilePath}`);
  }

  const browser = await chromium.launch({ headless, args: chromeArgs });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(meetingUrl, { waitUntil: 'domcontentloaded' });

  const id = `bot_${Date.now()}`;
  const bot: ActiveBot = { id, meetingUrl, browser, startedAt: new Date() };
  activeBots.set(id, bot);

  // Auto-leave after stayDurationMs unless something else calls leaveMeeting first.
  setTimeout(() => {
    if (activeBots.has(id)) {
      void leaveMeeting(id);
    }
  }, stayDurationMs);

  return bot;
}

export async function leaveMeeting(botId: string): Promise<boolean> {
  const bot = activeBots.get(botId);
  if (!bot) return false;
  await bot.browser.close();
  activeBots.delete(botId);
  return true;
}

export function listActiveBots(): Omit<ActiveBot, 'browser'>[] {
  return Array.from(activeBots.values()).map(({ browser, ...rest }) => rest);
}

export function defaultHelloAudioPath(): string {
  return path.resolve(__dirname, '..', '..', '..', 'assets', 'hello.wav');
}

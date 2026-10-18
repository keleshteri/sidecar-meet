jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
    launchPersistentContext: jest.fn(),
  },
}));

jest.mock('./audioDevice', () => ({
  getDefaultPlaybackDeviceId: jest.fn().mockResolvedValue(undefined),
  findPlaybackDeviceIdByLabel: jest.fn().mockResolvedValue(undefined),
  setDefaultPlaybackDeviceId: jest.fn().mockResolvedValue(undefined),
}));

import {
  joinMeeting,
  leaveMeeting,
  listActiveBots,
  defaultHelloAudioPath,
  defaultAuthStatePath,
  defaultChromeProfilePath,
} from './index';

describe('bot-engine default paths', () => {
  it('points the hello audio path at the shared assets directory', () => {
    expect(defaultHelloAudioPath().replace(/\\/g, '/')).toMatch(/assets\/hello\.wav$/);
  });

  it('points the auth state path at .auth/google.json', () => {
    expect(defaultAuthStatePath().replace(/\\/g, '/')).toMatch(/\.auth\/google\.json$/);
  });

  it('points the chrome profile path at .auth/chrome-profile', () => {
    expect(defaultChromeProfilePath().replace(/\\/g, '/')).toMatch(/\.auth\/chrome-profile$/);
  });
});

describe('joinMeeting input validation', () => {
  it('rejects a missing audio file before touching the browser', async () => {
    await expect(
      joinMeeting({
        meetingUrl: 'https://meet.google.com/xxx-yyyy-zzz',
        audioFilePath: 'does/not/exist.wav',
      }),
    ).rejects.toThrow(/Audio file not found/);
  });
});

describe('leaveMeeting / listActiveBots', () => {
  it('returns false when leaving a bot id that was never joined', async () => {
    await expect(leaveMeeting('not-a-real-bot-id')).resolves.toBe(false);
  });

  it('lists no active bots when none have joined', () => {
    expect(listActiveBots()).toEqual([]);
  });
});

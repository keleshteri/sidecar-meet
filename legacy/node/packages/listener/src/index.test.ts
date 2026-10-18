const mockCapture = { stop: jest.fn() };
const mockTranscriber = { send: jest.fn(), stop: jest.fn() };

jest.mock('./audioCapture', () => ({
  captureDeviceAudio: jest.fn(() => mockCapture),
}));

jest.mock('./transcriber', () => ({
  startTranscriber: jest.fn(() => mockTranscriber),
}));

import { startListening, stopListening, getTranscript } from './index';

describe('listener session lifecycle', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('has no transcript for a bot that never started listening', () => {
    expect(getTranscript('never-started')).toBeUndefined();
  });

  it('returns false when stopping a session that was never started', () => {
    expect(stopListening('never-started')).toBe(false);
  });

  it('starts a session and makes an (initially empty) transcript available', async () => {
    await startListening({ botId: 'bot-1' });
    expect(getTranscript('bot-1')).toEqual([]);
  });

  it('is a no-op to start a session twice for the same bot', async () => {
    await startListening({ botId: 'bot-2' });
    await startListening({ botId: 'bot-2' });
    const { captureDeviceAudio } = jest.requireMock('./audioCapture');
    expect(captureDeviceAudio).toHaveBeenCalledTimes(1);
  });

  it('stops capture and transcription, keeping transcript segments readable after stop', async () => {
    await startListening({ botId: 'bot-3' });
    expect(stopListening('bot-3')).toBe(true);
    expect(mockCapture.stop).toHaveBeenCalled();
    expect(mockTranscriber.stop).toHaveBeenCalled();
    expect(getTranscript('bot-3')).toEqual([]);
  });
});

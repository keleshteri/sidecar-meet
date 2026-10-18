import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BotService } from './bot.service';

jest.mock('@sidecar-meet/bot-engine', () => ({
  joinMeeting: jest.fn(),
  leaveMeeting: jest.fn(),
  listActiveBots: jest.fn(),
  defaultHelloAudioPath: jest.fn(() => '/fake/hello.wav'),
}));

jest.mock('@sidecar-meet/listener', () => ({
  startListening: jest.fn(),
  stopListening: jest.fn(),
  getTranscript: jest.fn(),
}));

import { joinMeeting, leaveMeeting, listActiveBots } from '@sidecar-meet/bot-engine';
import { startListening, stopListening, getTranscript } from '@sidecar-meet/listener';

describe('BotService', () => {
  let service: BotService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({ providers: [BotService] }).compile();
    service = moduleRef.get(BotService);
  });

  describe('join', () => {
    it('joins the meeting and starts the listener, returning the bot summary', async () => {
      const startedAt = new Date();
      (joinMeeting as jest.Mock).mockResolvedValue({ id: 'bot_1', meetingUrl: 'https://meet.google.com/abc', startedAt });

      const result = await service.join({ meetingUrl: 'https://meet.google.com/abc' });

      expect(joinMeeting).toHaveBeenCalledWith(
        expect.objectContaining({ meetingUrl: 'https://meet.google.com/abc', audioFilePath: '/fake/hello.wav' }),
      );
      expect(startListening).toHaveBeenCalledWith({ botId: 'bot_1' });
      expect(result).toEqual({ id: 'bot_1', meetingUrl: 'https://meet.google.com/abc', startedAt });
    });

    it('still returns the joined bot even if the listener fails to start', async () => {
      (joinMeeting as jest.Mock).mockResolvedValue({ id: 'bot_2', meetingUrl: 'https://meet.google.com/xyz', startedAt: new Date() });
      (startListening as jest.Mock).mockRejectedValue(new Error('no virtual cable installed'));

      const result = await service.join({ meetingUrl: 'https://meet.google.com/xyz' });

      expect(result.id).toBe('bot_2');
    });
  });

  describe('leave', () => {
    it('stops the listener and confirms the bot left', async () => {
      (leaveMeeting as jest.Mock).mockResolvedValue(true);

      const result = await service.leave('bot_1');

      expect(stopListening).toHaveBeenCalledWith('bot_1');
      expect(result).toEqual({ id: 'bot_1', left: true });
    });

    it('throws NotFoundException for a bot id that was never active', async () => {
      (leaveMeeting as jest.Mock).mockResolvedValue(false);

      await expect(service.leave('ghost')).rejects.toThrow(NotFoundException);
      expect(stopListening).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('delegates to listActiveBots', () => {
      (listActiveBots as jest.Mock).mockReturnValue([{ id: 'bot_1' }]);
      expect(service.list()).toEqual([{ id: 'bot_1' }]);
    });
  });

  describe('transcript', () => {
    it('returns transcript segments for an active bot', () => {
      (getTranscript as jest.Mock).mockReturnValue([{ text: 'hello', startedAt: new Date() }]);
      const result = service.transcript('bot_1');
      expect(result.id).toBe('bot_1');
      expect(result.segments).toHaveLength(1);
    });

    it('throws NotFoundException when there is no transcript for that bot id', () => {
      (getTranscript as jest.Mock).mockReturnValue(undefined);
      expect(() => service.transcript('ghost')).toThrow(NotFoundException);
    });
  });
});

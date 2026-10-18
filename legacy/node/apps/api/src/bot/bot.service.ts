import { Injectable, NotFoundException } from '@nestjs/common';
import {
  joinMeeting,
  leaveMeeting,
  listActiveBots,
  defaultHelloAudioPath,
} from '@sidecar-meet/bot-engine';
import { startListening, stopListening, getTranscript } from '@sidecar-meet/listener';
import { JoinMeetingDto } from './dto/join-meeting.dto';

@Injectable()
export class BotService {
  async join(dto: JoinMeetingDto) {
    const bot = await joinMeeting({
      meetingUrl: dto.meetingUrl,
      audioFilePath: dto.audioFilePath ?? defaultHelloAudioPath(),
      headless: dto.headless ?? false,
      chromeProfilePath: dto.chromeProfilePath,
      storageStatePath: dto.storageStatePath,
    });

    try {
      await startListening({ botId: bot.id });
    } catch (err) {
      // The bot already joined the meeting — a listener failure shouldn't
      // fail the join itself, same best-effort spirit as bot-engine's
      // clickJoinButton/unmuteMicrophone.
      // eslint-disable-next-line no-console
      console.warn(
        `[bot] Listener failed to start for bot ${bot.id}: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { id: bot.id, meetingUrl: bot.meetingUrl, startedAt: bot.startedAt };
  }

  async leave(botId: string) {
    const left = await leaveMeeting(botId);
    if (!left) {
      throw new NotFoundException(`No active bot with id ${botId}`);
    }
    stopListening(botId);
    return { id: botId, left: true };
  }

  list() {
    return listActiveBots();
  }

  transcript(botId: string) {
    const segments = getTranscript(botId);
    if (!segments) {
      throw new NotFoundException(`No transcript for bot id ${botId}`);
    }
    return { id: botId, segments };
  }
}

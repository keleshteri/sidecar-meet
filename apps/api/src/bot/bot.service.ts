import { Injectable, NotFoundException } from '@nestjs/common';
import {
  joinMeeting,
  leaveMeeting,
  listActiveBots,
  defaultHelloAudioPath,
} from '@sidecar-meet/bot-engine';
import { JoinMeetingDto } from './dto/join-meeting.dto';

@Injectable()
export class BotService {
  async join(dto: JoinMeetingDto) {
    const bot = await joinMeeting({
      meetingUrl: dto.meetingUrl,
      audioFilePath: dto.audioFilePath ?? defaultHelloAudioPath(),
      headless: dto.headless ?? false,
    });
    return { id: bot.id, meetingUrl: bot.meetingUrl, startedAt: bot.startedAt };
  }

  async leave(botId: string) {
    const left = await leaveMeeting(botId);
    if (!left) {
      throw new NotFoundException(`No active bot with id ${botId}`);
    }
    return { id: botId, left: true };
  }

  list() {
    return listActiveBots();
  }
}

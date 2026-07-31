import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { BotService } from './bot.service';
import { JoinMeetingDto } from './dto/join-meeting.dto';

@Controller('meetings')
export class BotController {
  constructor(private readonly botService: BotService) {}

  @Post('join')
  join(@Body() dto: JoinMeetingDto) {
    return this.botService.join(dto);
  }

  @Delete(':id')
  leave(@Param('id') id: string) {
    return this.botService.leave(id);
  }

  @Get()
  list() {
    return this.botService.list();
  }
}

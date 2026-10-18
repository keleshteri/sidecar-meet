import { Test } from '@nestjs/testing';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';

describe('BotController', () => {
  let controller: BotController;
  const botService = {
    join: jest.fn(),
    leave: jest.fn(),
    list: jest.fn(),
    transcript: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [BotController],
      providers: [{ provide: BotService, useValue: botService }],
    }).compile();
    controller = moduleRef.get(BotController);
  });

  it('POST /meetings/join delegates to BotService.join', async () => {
    botService.join.mockResolvedValue({ id: 'bot_1' });
    const dto = { meetingUrl: 'https://meet.google.com/abc' };
    await expect(controller.join(dto as never)).resolves.toEqual({ id: 'bot_1' });
    expect(botService.join).toHaveBeenCalledWith(dto);
  });

  it('DELETE /meetings/:id delegates to BotService.leave', async () => {
    botService.leave.mockResolvedValue({ id: 'bot_1', left: true });
    await expect(controller.leave('bot_1')).resolves.toEqual({ id: 'bot_1', left: true });
    expect(botService.leave).toHaveBeenCalledWith('bot_1');
  });

  it('GET /meetings delegates to BotService.list', () => {
    botService.list.mockReturnValue([{ id: 'bot_1' }]);
    expect(controller.list()).toEqual([{ id: 'bot_1' }]);
  });

  it('GET /meetings/:id/transcript delegates to BotService.transcript', () => {
    botService.transcript.mockReturnValue({ id: 'bot_1', segments: [] });
    expect(controller.transcript('bot_1')).toEqual({ id: 'bot_1', segments: [] });
    expect(botService.transcript).toHaveBeenCalledWith('bot_1');
  });
});

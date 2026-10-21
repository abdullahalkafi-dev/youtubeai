import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { DailyService } from '../pipeline/daily.service';
import { ReelAuthGuard } from './auth.guard';
import { DailySettingsDto, parse } from './dto';

/** The Daily tab: the nightly automatic campaign (on/off, run now, per-day results and insights). */
@Controller('channels/:channelId/daily')
@UseGuards(ReelAuthGuard)
export class DailyController {
  constructor(private readonly daily: DailyService) {}

  @Get()
  overview(@Param('channelId') channelId: string) {
    return this.daily.overview(channelId);
  }

  @Patch()
  async settings(@Param('channelId') channelId: string, @Body() body: unknown) {
    await this.daily.setEnabled(channelId, parse(DailySettingsDto, body).enabled);
    return this.daily.overview(channelId);
  }

  /** What the brain would pick today, scored and explained, without starting anything (one model call). */
  @Post('preview')
  preview(@Param('channelId') channelId: string) {
    return this.daily.preview(channelId);
  }

  @Post('run')
  async runNow(@Param('channelId') channelId: string) {
    await this.daily.runForChannel(channelId, 'manual');
    return this.daily.overview(channelId);
  }
}

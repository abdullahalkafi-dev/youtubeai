import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { DailyService } from '../pipeline/daily.service';
import { AutoPublishService } from '../publishing/auto-publish.service';
import { LearningService } from '../publishing/learning.service';
import { PublishService } from '../publishing/publish.service';
import { ReelAuthGuard } from './auth.guard';
import { AutoPublishMoveDto, AutoPublishSettingsDto, DailySettingsDto, parse } from './dto';

/** The Daily tab: the nightly automatic campaign (on/off, run now, per-day results and insights). */
@Controller('channels/:channelId/daily')
@UseGuards(ReelAuthGuard)
export class DailyController {
  constructor(
    private readonly daily: DailyService,
    private readonly auto: AutoPublishService,
    private readonly publish: PublishService,
    private readonly learning: LearningService,
  ) {}

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

  /** Write this week's "what worked" review now (one model call; it only says something once enough posts have settled). */
  @Post('review')
  async review(@Param('channelId') channelId: string) {
    await this.learning.review(channelId);
    return this.daily.overview(channelId);
  }

  // ------------------------------------------------------------------ Auto-publish

  @Get('autopublish')
  autoOverview(@Param('channelId') channelId: string) {
    return this.auto.overview(channelId);
  }

  @Patch('autopublish')
  async autoSettings(@Param('channelId') channelId: string, @Body() body: unknown) {
    await this.auto.update(channelId, parse(AutoPublishSettingsDto, body));
    return this.auto.overview(channelId);
  }

  /** Plan today's posts now (instead of waiting for the next 10-minute check). Does nothing while the switch is off. */
  @Post('autopublish/plan')
  async autoPlan(@Param('channelId') channelId: string) {
    const result = await this.auto.plan(channelId);
    return { result, ...(await this.auto.overview(channelId)) };
  }

  @Post('autopublish/posts/:postId/now')
  async autoNow(@Param('channelId') channelId: string, @Param('postId') postId: string) {
    await this.publish.rescheduleAuto(channelId, postId, new Date());
    return this.auto.overview(channelId);
  }

  @Post('autopublish/posts/:postId/move')
  async autoMove(@Param('channelId') channelId: string, @Param('postId') postId: string, @Body() body: unknown) {
    await this.publish.rescheduleAuto(channelId, postId, new Date(parse(AutoPublishMoveDto, body).runAt));
    return this.auto.overview(channelId);
  }

  @Post('autopublish/posts/:postId/cancel')
  async autoCancel(@Param('channelId') channelId: string, @Param('postId') postId: string) {
    await this.publish.cancel(channelId, postId);
    return this.auto.overview(channelId);
  }
}

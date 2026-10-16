import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AnalyticsService } from '../publishing/analytics.service';
import { MetricsService } from '../publishing/metrics.service';
import { PublishService } from '../publishing/publish.service';
import { PublisherRegistry } from '../publishing/registry';
import { AuthedRequest, ReelAuthGuard } from './auth.guard';
import { AnalyticsQuery, ManualPostDto, parse, PostsQuery, PreflightDto, PublishDto } from './dto';
import { Inject } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';

/**
 * Publishing is MANUAL: nothing here ever posts without a person calling POST …/posts with `confirm: true`.
 * (`publishMode` is reported so the UI can say so; automation would be a separate, later setting.)
 */
@Controller('channels/:channelId')
@UseGuards(ReelAuthGuard)
export class PublishingController {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly publishing: PublishService,
    private readonly registry: PublisherRegistry,
    private readonly metrics: MetricsService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get('accounts')
  async accounts(@Param('channelId') channelId: string) {
    const accounts = await Promise.all(
      this.registry.list().map(async (p) => ({ ...(await p.getAccountStatus(channelId)), capabilities: p.capabilities })),
    );
    return { publishMode: 'manual', defaultPrivacy: this.cfg.PUBLISH_DEFAULT_PRIVACY, accounts, planned: this.registry.planned() };
  }

  @Post('reels/:reelId/preflight')
  async preflight(@Param('channelId') channelId: string, @Param('reelId') reelId: string, @Body() body: unknown) {
    const dto = parse(PreflightDto, body);
    return this.publishing.preflight(channelId, reelId, dto.platform, dto.metadata, dto.allowDuplicate);
  }

  @Post('reels/:reelId/posts')
  publish(@Param('channelId') channelId: string, @Param('reelId') reelId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const dto = parse(PublishDto, body);
    return this.publishing.createPost(channelId, req.user!.id, reelId, dto);
  }

  @Post('reels/:reelId/posts/manual')
  manual(@Param('channelId') channelId: string, @Param('reelId') reelId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.publishing.createManual(channelId, req.user!.id, reelId, parse(ManualPostDto, body));
  }

  @Get('reels/:reelId/posts')
  forReel(@Param('channelId') channelId: string, @Param('reelId') reelId: string) {
    return this.publishing.listForReel(channelId, reelId);
  }

  @Get('posts')
  list(@Param('channelId') channelId: string, @Query() query: Record<string, string>) {
    return this.publishing.list(channelId, parse(PostsQuery, query));
  }

  @Get('posts/:postId')
  get(@Param('channelId') channelId: string, @Param('postId') postId: string) {
    return this.publishing.get(channelId, postId);
  }

  @Post('posts/:postId/cancel')
  cancel(@Param('channelId') channelId: string, @Param('postId') postId: string) {
    return this.publishing.cancel(channelId, postId);
  }

  @Post('posts/:postId/retry')
  retry(@Param('channelId') channelId: string, @Param('postId') postId: string) {
    return this.publishing.retry(channelId, postId);
  }

  @Post('posts/:postId/refresh-metrics')
  refresh(@Param('channelId') channelId: string, @Param('postId') postId: string) {
    return this.metrics.refreshOne(channelId, postId);
  }

  @Get('analytics/overview')
  overview(@Param('channelId') channelId: string, @Query() query: Record<string, string>) {
    return this.analytics.overview(channelId, parse(AnalyticsQuery, query).period);
  }

  @Get('analytics/breakdown')
  breakdown(@Param('channelId') channelId: string, @Query() query: Record<string, string>) {
    const q = parse(AnalyticsQuery, query);
    return this.analytics.breakdown(channelId, q.by, q.period);
  }

  @Get('analytics/posts/:postId/series')
  series(@Param('channelId') channelId: string, @Param('postId') postId: string) {
    return this.analytics.series(channelId, postId);
  }
}

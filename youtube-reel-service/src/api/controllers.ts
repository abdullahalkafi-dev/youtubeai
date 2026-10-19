import { Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { Request, Response } from 'express';
import { AppConfig, CONFIG } from '../config/config';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { BUCKETS, StorageService } from '../storage/storage.service';
import { QueueService } from '../queue/queue.service';
import { YouTubeSessionService } from '../pipeline/youtube-session.service';
import { AuthedRequest, ReelAuthGuard } from './auth.guard';
import { AnalyticsService } from '../publishing/analytics.service';
import { CampaignChatService } from './campaign-chat.service';
import { CampaignDeleteService } from './campaign-delete.service';
import { CampaignChatDto, CookiesDto, CreateCampaignDto, ListReelsQuery, parse, PatchReelDto } from './dto';
import { ReelsApiService } from './reels-api.service';

const uid = (req: AuthedRequest) => req.user!.id;

@Controller()
export class HealthController {
  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {}

  @Get('health')
  health() {
    return { ok: true, enabled: this.cfg.REELS_ENABLED };
  }
}

@Controller()
@UseGuards(ReelAuthGuard)
export class StatusController {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly session: YouTubeSessionService,
    private readonly queues: QueueService,
  ) {}

  /** Everything the Reels page header needs: kill-switch, YouTube connection, queue depth. */
  @Get('status')
  async status() {
    const counts = await this.queues.counts();
    return {
      enabled: this.cfg.REELS_ENABLED,
      youtube: await this.session.publicState(),
      queues: Object.fromEntries(
        Object.entries(counts).map(([k, v]) => [k, { waiting: v.waiting + v.delayed, active: v.active, failed: v.failed, paused: v.paused }]),
      ),
    };
  }

  @Post('youtube-session/cookies')
  async uploadCookies(@Body() body: unknown) {
    const dto = parse(CookiesDto, body);
    return this.session.saveCookies(dto.cookies);
  }

  @Post('youtube-session/check')
  async checkSession() {
    const s = await this.session.check();
    return { status: s.status, lastError: s.lastError ?? null, lastCheckAt: s.lastCheckAt ?? null };
  }
}

@Controller('channels/:channelId')
@UseGuards(ReelAuthGuard)
export class CampaignsController {
  constructor(
    private readonly api: ReelsApiService,
    private readonly analytics: AnalyticsService,
    private readonly chat: CampaignChatService,
    private readonly remover: CampaignDeleteService,
  ) {}

  @Post('campaigns')
  create(@Param('channelId') channelId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.api.createCampaign(channelId, uid(req), parse(CreateCampaignDto, body));
  }

  @Get('campaigns')
  list(@Param('channelId') channelId: string, @Query('limit') limit?: string) {
    return this.api.listCampaigns(channelId, Number(limit) || 30);
  }

  @Get('campaigns/:campaignId')
  get(@Param('channelId') channelId: string, @Param('campaignId') id: string, @Req() req: AuthedRequest) {
    return this.api.getCampaign(channelId, id, uid(req));
  }

  @Post('campaigns/:campaignId/cancel')
  cancel(@Param('channelId') channelId: string, @Param('campaignId') id: string) {
    return this.api.cancelCampaign(channelId, id);
  }

  @Post('campaigns/:campaignId/top-up')
  topUp(@Param('channelId') channelId: string, @Param('campaignId') id: string, @Body() body: { count?: number } | undefined) {
    const count = Number(body?.count);
    return this.api.topUp(channelId, id, Number.isFinite(count) && count > 0 ? count : undefined);
  }

  @Get('campaigns/:campaignId/delete-preview')
  deletePreview(@Param('channelId') channelId: string, @Param('campaignId') id: string) {
    return this.remover.preview(channelId, id);
  }

  @Delete('campaigns/:campaignId')
  deleteCampaign(@Param('channelId') channelId: string, @Param('campaignId') id: string) {
    return this.remover.remove(channelId, id);
  }

  @Get('campaigns/:campaignId/performance')
  performance(@Param('channelId') channelId: string, @Param('campaignId') id: string) {
    return this.analytics.campaignPerformance(channelId, id);
  }

  @Get('campaigns/:campaignId/chat')
  chatHistory(@Param('channelId') channelId: string, @Param('campaignId') id: string) {
    return this.chat.history(channelId, id);
  }

  @Post('campaigns/:campaignId/chat')
  chatAsk(@Param('channelId') channelId: string, @Param('campaignId') id: string, @Body() body: unknown) {
    return this.chat.ask(channelId, id, parse(CampaignChatDto, body).question);
  }

  @Delete('campaigns/:campaignId/chat')
  chatClear(@Param('channelId') channelId: string, @Param('campaignId') id: string) {
    return this.chat.clear(channelId, id);
  }

  @Post('campaigns/:campaignId/refresh-look')
  refreshLook(@Param('channelId') channelId: string, @Param('campaignId') id: string) {
    return this.api.refreshLook(channelId, id);
  }

  @Post('campaigns/:campaignId/retry-failed')
  retry(@Param('channelId') channelId: string, @Param('campaignId') id: string) {
    return this.api.retryFailedRenders(channelId, id);
  }

  @Get('reels')
  reels(@Param('channelId') channelId: string, @Query() query: Record<string, string>, @Req() req: AuthedRequest) {
    return this.api.listReels(channelId, uid(req), parse(ListReelsQuery, query));
  }

  @Get('reels/:reelId')
  reel(@Param('channelId') channelId: string, @Param('reelId') reelId: string, @Req() req: AuthedRequest) {
    return this.api.getReel(channelId, reelId, uid(req));
  }

  @Patch('reels/:reelId')
  patch(@Param('channelId') channelId: string, @Param('reelId') reelId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.api.patchReel(channelId, reelId, uid(req), parse(PatchReelDto, body));
  }

  @Post('reels/:reelId/rerender')
  rerender(@Param('channelId') channelId: string, @Param('reelId') reelId: string) {
    return this.api.rerender(channelId, reelId);
  }

  @Post('reels/:reelId/visuals/:visualId/replace')
  replaceVisual(@Param('channelId') channelId: string, @Param('reelId') reelId: string, @Param('visualId') visualId: string) {
    return this.api.changeVisual(channelId, reelId, visualId, 'replace');
  }

  @Post('reels/:reelId/visuals/:visualId/remove')
  removeVisual(@Param('channelId') channelId: string, @Param('reelId') reelId: string, @Param('visualId') visualId: string) {
    return this.api.changeVisual(channelId, reelId, visualId, 'remove');
  }

  @Post('reels/:reelId/thumbnails/regenerate')
  regenerateThumbnails(@Param('channelId') channelId: string, @Param('reelId') reelId: string, @Req() req: AuthedRequest) {
    return this.api.regenerateThumbnails(channelId, reelId, uid(req));
  }

  @Post('reels/:reelId/thumbnails/:thumbId/choose')
  chooseThumbnail(@Param('channelId') channelId: string, @Param('reelId') reelId: string, @Param('thumbId') thumbId: string, @Req() req: AuthedRequest) {
    return this.api.chooseThumbnail(channelId, reelId, thumbId, uid(req));
  }

  @Get('coverage')
  coverage(@Param('channelId') channelId: string) {
    return this.api.coverage(channelId);
  }

  @Get('insights')
  insights(@Param('channelId') channelId: string, @Query('period') period?: string) {
    return this.api.insights(channelId, period === 'month' ? 'month' : 'week');
  }
}

/**
 * Media is fetched by <video>/<img> tags which cannot send Authorization headers,
 * so each URL carries a short-lived, reel-scoped signed token instead.
 */
@Controller('media')
export class MediaController {
  constructor(
    @InjectModel(Reel.name) private readonly reels: Model<ReelDocument>,
    private readonly storage: StorageService,
    private readonly api: ReelsApiService,
  ) {}

  @Get(':reelId/:kind')
  async serve(@Param('reelId') reelId: string, @Param('kind') kind: string, @Query('t') token: string, @Req() req: Request, @Res() res: Response) {
    if (!token || !(await this.api.verifyMediaToken(token, reelId))) throw new UnauthorizedException('Invalid media link');
    const reel = await this.reels.findById(reelId).select('assets packaging.title index visuals thumbnails').lean();
    const key = kind.startsWith('thumb-')
      ? reel?.thumbnails?.find((t) => `thumb-${t.id}` === kind && t.status === 'ready')?.key
      : kind.startsWith('beat-')
      ? reel?.visuals?.find((v) => `beat-${v.id}` === kind && v.status === 'ready')?.key
      : kind === 'video' || kind === 'download'
        ? reel?.assets?.videoKey
        : kind === 'cover'
          ? reel?.assets?.coverKey
          : kind === 'srt'
            ? reel?.assets?.srtKey
            : undefined;
    if (!reel || !key) throw new NotFoundException('Media not found');
    const stat = await this.storage.stat(BUCKETS.reels, key);
    if (!stat) throw new NotFoundException('Media not found');

    const type = kind === 'cover' ? 'image/jpeg' : kind === 'srt' ? 'application/x-subrip' : 'video/mp4';
    res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (kind === 'download' || kind === 'srt') {
      const base = (reel.packaging?.title || `reel-${reel.index}`).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'reel';
      res.setHeader('Content-Disposition', `attachment; filename="${base}.${kind === 'srt' ? 'srt' : 'mp4'}"`);
    }

    const size = stat.size;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (kind === 'video' || kind === 'download')) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      if (!range[1]) end = size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`);
        return res.end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      const stream = await this.storage.getRange(BUCKETS.reels, key, start, end - start + 1);
      stream.on('error', () => res.destroy());
      return stream.pipe(res);
    }
    res.setHeader('Content-Length', String(size));
    const stream = await this.storage.getStream(BUCKETS.reels, key);
    stream.on('error', () => res.destroy());
    return stream.pipe(res);
  }
}

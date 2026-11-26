import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppConfig, CONFIG } from '../config';
import { BuzzsproutClient } from '../buzzsprout/buzzsprout.client';
import { PodcastEpisode, PodcastEpisodeDocument } from '../db/schemas';
import { BUZZSPROUT, EpisodeService } from '../pipeline/episode.service';
import { PodcastAuthGuard } from './auth.guard';

let showCache: { at: number; value: { title: string; rssUrl: string | null; artworkUrl: string | null } | null } = { at: 0, value: null };

@Controller()
export class PodcastController {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    @Inject(BUZZSPROUT) private readonly bs: BuzzsproutClient,
    @InjectModel(PodcastEpisode.name) private readonly episodes: Model<PodcastEpisodeDocument>,
    private readonly service: EpisodeService,
  ) {}

  /** No auth: used by the container health check. */
  @Get('health')
  health() {
    return { ok: true, enabled: this.cfg.PODCAST_ENABLED, auto: this.cfg.PODCAST_AUTO };
  }

  @UseGuards(PodcastAuthGuard)
  @Get('channels/:channelId/status')
  async status(@Param('channelId') channelId: string) {
    const [counts, show, since, latest] = await Promise.all([
      this.service.counts(channelId),
      this.show(),
      this.service.autoSinceForStatus(),
      this.episodes.findOne({ channelId: new Types.ObjectId(channelId), status: 'uploaded' }).sort({ finishedAt: -1 }).select('title buzzsprout.pageUrl buzzsprout.publishedAt').lean(),
    ]);
    return {
      enabled: this.cfg.PODCAST_ENABLED,
      auto: this.cfg.PODCAST_AUTO === 'on',
      autoSince: since,
      minDurationSec: this.cfg.PODCAST_MIN_DURATION_SEC,
      show,
      counts,
      latest: latest ? { title: latest.title, pageUrl: (latest as any).buzzsprout?.pageUrl ?? null, publishedAt: (latest as any).buzzsprout?.publishedAt ?? null } : null,
    };
  }

  @UseGuards(PodcastAuthGuard)
  @Get('channels/:channelId/episodes')
  async list(@Param('channelId') channelId: string, @Query('limit') limit?: string) {
    return { episodes: await this.service.list(channelId, Math.min(200, Math.max(1, Number(limit) || 50))) };
  }

  @UseGuards(PodcastAuthGuard)
  @Get('channels/:channelId/episodes/:youtubeId')
  async one(@Param('channelId') channelId: string, @Param('youtubeId') youtubeId: string) {
    const ep = await this.episodes.findOne({ channelId: new Types.ObjectId(channelId), youtubeId }).lean();
    if (!ep) throw new NotFoundException('Episode not found');
    return ep;
  }

  /** Put one specific video on the podcast now (it is picked up by the scheduler within a minute). */
  @UseGuards(PodcastAuthGuard)
  @Post('channels/:channelId/episodes')
  async add(@Param('channelId') channelId: string, @Body() body: { youtubeId?: string }) {
    const id = (body?.youtubeId ?? '').trim();
    if (!/^[\w-]{11}$/.test(id)) throw new BadRequestException('youtubeId must be the 11-character YouTube video id');
    try {
      return await this.service.enqueue(id, channelId);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  @UseGuards(PodcastAuthGuard)
  @Post('channels/:channelId/episodes/:youtubeId/retry')
  async retry(@Param('youtubeId') youtubeId: string) {
    const ep = await this.service.retry(youtubeId);
    if (!ep) throw new BadRequestException('Only failed or skipped episodes can be retried');
    return ep;
  }

  private async show() {
    if (showCache.value && Date.now() - showCache.at < 5 * 60_000) return showCache.value;
    try {
      const p = (await this.bs.podcasts()).find((x) => String(x.id) === this.cfg.BUZZSPROUT_PODCAST_ID);
      showCache = { at: Date.now(), value: p ? { title: p.title, rssUrl: p.rss_url ?? null, artworkUrl: p.artwork_url ?? null } : null };
    } catch {
      /* Buzzsprout unreachable: the page still works without the show card */
    }
    return showCache.value;
  }
}

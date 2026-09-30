import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { YouTubeService } from './youtube.service';
import { QuotaService } from '../quota/quota.service';

export interface VideoReachMetrics {
  videoId: string;
  /** Thumbnail impressions (Reporting API: video_thumbnail_impressions) */
  impressions: number;
  /** CTR 0–100 (Reporting API: video_thumbnail_impressions_ctr) */
  ctr: number;
  date?: string;
}

/**
 * YouTube Reporting API — Reach reports (the ONLY official source of thumbnail CTR).
 * Analytics API reports.query does NOT support videoThumbnail* metrics on channel reports.
 * Report type: channel_reach_basic_a1 (video_thumbnail_impressions, video_thumbnail_impressions_ctr).
 * Data is bulk/daily (can lag ~24–48h).
 */
@Injectable()
export class YoutubeReportingService {
  private readonly logger = new Logger(YoutubeReportingService.name);
  private readonly REACH_REPORT_TYPE = 'channel_reach_basic_a1';
  /** YouTube Reporting docs: thumbnail CTR is a percentage (0–100), not a 0–1 fraction. */
  private readonly CTR_UNIT = 'percent_0_100';

  constructor(
    private readonly youtubeService: YouTubeService,
    private readonly quotaService: QuotaService,
  ) {}

  private getClient(accessToken: string): any {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    // googleapis exports `youtubereporting` (lowercase). `youtubeReporting` is undefined and throws.
    const factory = (google as any).youtubereporting || (google as any).youtubeReporting;
    if (typeof factory !== 'function') {
      throw new Error('googleapis youtubereporting factory missing');
    }
    return factory({ version: 'v1', auth: oauth2Client });
  }

  /** Ensure a reach job exists; return jobId. */
  async ensureReachJob(userId: string): Promise<string | null> {
    try {
      const accessToken = await this.youtubeService.getValidAccessToken(userId);
      if (!accessToken) {
        this.logger.warn('[Reach] ensureReachJob: no access token');
        return null;
      }
      const reporting = this.getClient(accessToken);

      const list = await reporting.jobs.list({ includeSystemManaged: true });
      const jobs = list.data.jobs || [];
      this.logger.log(
        `[Reach] jobs.list: ${jobs.length} job(s) types=${jobs.map((j: any) => j.reportTypeId).join('|') || 'none'}`,
      );
      const existing = jobs.find(
        (j: any) => j.reportTypeId === this.REACH_REPORT_TYPE,
      );
      if (existing?.id) {
        this.logger.log(`[Reach] using existing job id=${existing.id}`);
        return existing.id;
      }

      const created = await reporting.jobs.create({
        requestBody: {
          reportTypeId: this.REACH_REPORT_TYPE,
          name: 'MAE reach (thumbnail CTR)',
        },
      });
      this.logger.log(`[Reach] Created job id=${created.data.id} type=${this.REACH_REPORT_TYPE} (data lags 24–48h)`);
      return created.data.id || null;
    } catch (err: any) {
      this.logger.warn(`[Reach] ensureReachJob failed: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Reach rows (per video) from recent daily reports, impressions summed
   * and CTR impression-weighted across days. Optional videoId filter.
   */
  async getReachMetrics(
    userId: string,
    videoIds?: string[],
  ): Promise<VideoReachMetrics[]> {
    try {
      const jobId = await this.ensureReachJob(userId);
      if (!jobId) {
        this.logger.warn('[Reach] getReachMetrics: no jobId (see ensureReachJob log)');
        return [];
      }

      const accessToken = await this.youtubeService.getValidAccessToken(userId);
      if (!accessToken) {
        this.logger.warn('[Reach] getReachMetrics: no access token');
        return [];
      }
      const reporting = this.getClient(accessToken);

      const reports = await reporting.jobs.reports.list({
        jobId,
        pageSize: 10,
      });
      const items = reports.data.reports || [];
      this.logger.log(`[Reach] reports.list job=${jobId} count=${items.length}`);
      if (!items.length) {
        this.logger.warn('[Reach] no reports yet — data can lag 24–48h after job create');
        return [];
      }

      // Newest first (list is typically newest first; sort defensively)
      const sorted = [...items].sort((a, b) =>
        String(b.startTime || '').localeCompare(String(a.startTime || '')),
      );
      const usable = sorted.filter((r: any) => r.downloadUrl).slice(0, 7);
      if (!usable.length) {
        this.logger.warn('[Reach] reports have no downloadUrl yet');
        return [];
      }
      this.logger.log(
        `[Reach] downloading ${usable.length} report file(s) range=${usable[usable.length - 1]?.startTime || '?'}..${usable[0]?.startTime || '?'}`,
      );

      // Merge days: sum impressions, impression-weighted CTR
      const merged = new Map<string, { impressions: number; ctrWeighted: number }>();
      let downloaded = 0;
      for (const report of usable) {
        try {
          const res = await fetch(report.downloadUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok) {
            this.logger.warn(`[Reach] download HTTP ${res.status} for report ${report.id || report.startTime}`);
            continue;
          }
          const text = await res.text();
          const rows = this.parseReachCsv(text, videoIds);
          downloaded++;
          for (const row of rows) {
            const prev = merged.get(row.videoId) || { impressions: 0, ctrWeighted: 0 };
            prev.impressions += row.impressions;
            prev.ctrWeighted += row.impressions * row.ctr;
            merged.set(row.videoId, prev);
          }
        } catch (dlErr: any) {
          this.logger.warn(`[Reach] download error: ${dlErr?.message || dlErr}`);
        }
      }

      await this.quotaService.logAnalyticsCall({
        channelId: 'reporting',
        endpoint: `reporting.jobs.reports (${this.REACH_REPORT_TYPE})`,
        success: true,
      });

      const out: VideoReachMetrics[] = [];
      for (const [videoId, v] of merged.entries()) {
        out.push({
          videoId,
          impressions: v.impressions,
          ctr: v.impressions > 0 ? Math.round((v.ctrWeighted / v.impressions) * 100) / 100 : 0,
        });
      }
      this.logger.log(
        `[Reach] merged rows=${out.length} files=${downloaded}/${usable.length} filter=${videoIds?.length ? videoIds.join(',') : 'none'} unit=${this.CTR_UNIT}`,
      );
      if (out.length > 0) {
        const sample = out.slice(0, 5).map((r) => `${r.videoId}:imp=${r.impressions},ctr=${r.ctr}`).join(' | ');
        this.logger.log(`[Reach] sample ${sample}`);
      } else if (downloaded === 0) {
        this.logger.warn('[Reach] 0 files downloaded — CTR empty (auth/URL issue)');
      } else {
        this.logger.warn('[Reach] files downloaded but 0 rows — check [Reach] header/missing-columns logs');
      }
      return out;
    } catch (err: any) {
      this.logger.warn(`[Reach] getReachMetrics failed: ${err?.message || err}`);
      return [];
    }
  }

  /** Find first header index matching any alias (case-insensitive). */
  private findCol(header: string[], aliases: string[]): number {
    const lower = header.map((h) => h.toLowerCase().replace(/^"|"$/g, '').trim());
    for (const alias of aliases) {
      const i = lower.indexOf(alias.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  }

  /**
   * Parse reach CSV. Logs full header when columns are missing so prod can diagnose.
   * CTR unit: percentage 0–100 (YouTube Reporting docs). Values in (0,1] stay as-is
   * (e.g. 0.8 → 0.8%), never ×100 (that would show 80%).
   */
  private parseReachCsv(csv: string, filterIds?: string[]): VideoReachMetrics[] {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      this.logger.warn(`[Reach] CSV too short (lines=${lines.length}) — need header + rows`);
      return [];
    }
    const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    const idx = {
      date: this.findCol(header, ['date', 'day']),
      video: this.findCol(header, ['video_id', 'videoid', 'video', 'id']),
      imp: this.findCol(header, [
        'video_thumbnail_impressions',
        'thumbnail_impressions',
        'impressions',
      ]),
      ctr: this.findCol(header, [
        'video_thumbnail_impressions_ctr',
        'thumbnail_impressions_ctr',
        'impressions_ctr',
        'ctr',
      ]),
    };
    if (idx.video < 0) {
      this.logger.warn(
        `[Reach] CSV missing video column. header=${JSON.stringify(header)} rows=${lines.length - 1}`,
      );
      return [];
    }
    if (idx.imp < 0 || idx.ctr < 0) {
      this.logger.warn(
        `[Reach] CSV missing metrics. impIdx=${idx.imp} ctrIdx=${idx.ctr} header=${JSON.stringify(header)}`,
      );
    }

    const want = filterIds?.length ? new Set(filterIds) : null;
    const out: VideoReachMetrics[] = [];
    let loggedSample = false;
    for (let i = 1; i < lines.length; i++) {
      const cols = this.splitCsvLine(lines[i]);
      const videoId = (cols[idx.video] || '').replace(/^"|"$/g, '');
      if (!videoId) continue;
      if (want && !want.has(videoId)) continue;
      const impressions = idx.imp >= 0 ? Number(cols[idx.imp] || 0) || 0 : 0;
      const ctrRaw = idx.ctr >= 0 ? Number(cols[idx.ctr] || 0) || 0 : 0;
      // FIXED RULE: Reporting CTR is already percent 0–100. Do not scale ≤1 up by 100.
      const ctr = Math.round(ctrRaw * 100) / 100;
      if (!loggedSample) {
        this.logger.log(
          `[Reach] row sample video=${videoId} raw_ctr=${ctrRaw} => ctr%=${ctr} imp=${impressions} unit=${this.CTR_UNIT} (compare vs Studio)`,
        );
        loggedSample = true;
      }
      out.push({
        videoId,
        impressions,
        ctr,
        date: idx.date >= 0 ? (cols[idx.date] || '').replace(/^"|"$/g, '') : undefined,
      });
    }
    return out;
  }

  private splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === ',' && !inQ) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
}

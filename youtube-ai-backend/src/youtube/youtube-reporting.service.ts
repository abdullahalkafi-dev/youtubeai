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

  constructor(
    private readonly youtubeService: YouTubeService,
    private readonly quotaService: QuotaService,
  ) {}

  private getClient(accessToken: string): any {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    // googleapis youtubeReporting factory (typed loosely across versions)
    const factory = (google as any).youtubeReporting;
    return factory({ version: 'v1', auth: oauth2Client });
  }

  /** Ensure a reach job exists; return jobId. */
  async ensureReachJob(userId: string): Promise<string | null> {
    try {
      const accessToken = await this.youtubeService.getValidAccessToken(userId);
      if (!accessToken) return null;
      const reporting = this.getClient(accessToken);

      const list = await reporting.jobs.list({ includeSystemManaged: true });
      const existing = (list.data.jobs || []).find(
        (j: any) => j.reportTypeId === this.REACH_REPORT_TYPE,
      );
      if (existing?.id) return existing.id;

      const created = await reporting.jobs.create({
        requestBody: {
          reportTypeId: this.REACH_REPORT_TYPE,
          name: 'MAE reach (thumbnail CTR)',
        },
      });
      this.logger.log(`Created Reporting job ${created.data.id} for ${this.REACH_REPORT_TYPE}`);
      return created.data.id || null;
    } catch (err: any) {
      this.logger.warn(`ensureReachJob failed: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * Latest reach rows (per video) from the newest available report.
   * Prefer a specific videoId filter when provided.
   */
  async getReachMetrics(
    userId: string,
    videoIds?: string[],
  ): Promise<VideoReachMetrics[]> {
    try {
      const jobId = await this.ensureReachJob(userId);
      if (!jobId) return [];

      const accessToken = await this.youtubeService.getValidAccessToken(userId);
      if (!accessToken) return [];
      const reporting = this.getClient(accessToken);

      const reports = await reporting.jobs.reports.list({
        jobId,
        pageSize: 5,
      });
      const items = reports.data.reports || [];
      if (!items.length) {
        this.logger.warn('No reach reports yet (job created — data can lag 24–48h)');
        return [];
      }

      // Newest first (list is typically newest first; sort defensively)
      const sorted = [...items].sort((a, b) =>
        String(b.startTime || '').localeCompare(String(a.startTime || '')),
      );
      const latest = sorted[0];
      const downloadUrl = latest.downloadUrl;
      if (!downloadUrl) {
        this.logger.warn('Reach report has no downloadUrl yet');
        return [];
      }

      const res = await fetch(downloadUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        this.logger.warn(`Reach report download failed: HTTP ${res.status}`);
        return [];
      }
      const text = await res.text();
      const rows = this.parseReachCsv(text, videoIds);
      await this.quotaService.logAnalyticsCall({
        channelId: 'reporting',
        endpoint: `reporting.jobs.reports (${this.REACH_REPORT_TYPE})`,
        success: true,
      });
      return rows;
    } catch (err: any) {
      this.logger.warn(`getReachMetrics failed: ${err?.message || err}`);
      return [];
    }
  }

  private parseReachCsv(csv: string, filterIds?: string[]): VideoReachMetrics[] {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    const idx = {
      date: header.indexOf('date'),
      video: header.indexOf('video_id'),
      imp: header.indexOf('video_thumbnail_impressions'),
      ctr: header.indexOf('video_thumbnail_impressions_ctr'),
    };
    if (idx.video < 0) return [];

    const want = filterIds?.length ? new Set(filterIds) : null;
    const out: VideoReachMetrics[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = this.splitCsvLine(lines[i]);
      const videoId = (cols[idx.video] || '').replace(/^"|"$/g, '');
      if (!videoId) continue;
      if (want && !want.has(videoId)) continue;
      const impressions = Number(cols[idx.imp] || 0) || 0;
      const ctrRaw = Number(cols[idx.ctr] || 0) || 0;
      const ctr = ctrRaw > 0 && ctrRaw <= 1 ? Math.round(ctrRaw * 10000) / 100 : Math.round(ctrRaw * 100) / 100;
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

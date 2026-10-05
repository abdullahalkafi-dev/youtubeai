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
  /** YouTube Reporting API delivers thumbnail CTR as a 0.0–1.0 decimal fraction (e.g. 0.0277... = 2.78%). */
  private readonly CTR_UNIT = 'percent_0_100_converted_from_fraction';

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

  /** Ensure a report job exists for the given report type; return jobId. */
  async ensureJob(
    userId: string,
    reportType: string,
    name: string,
  ): Promise<string | null> {
    try {
      const accessToken = await this.youtubeService.getValidAccessToken(userId);
      if (!accessToken) {
        this.logger.warn(`[Reporting] ensureJob(${reportType}): no access token`);
        return null;
      }
      const reporting = this.getClient(accessToken);

      const list = await reporting.jobs.list({ includeSystemManaged: true });
      const jobs = list.data.jobs || [];
      this.logger.log(
        `[Reporting] jobs.list: ${jobs.length} job(s) types=${jobs.map((j: any) => j.reportTypeId).join('|') || 'none'}`,
      );
      const existing = jobs.find(
        (j: any) => j.reportTypeId === reportType,
      );
      if (existing?.id) {
        this.logger.log(`[Reporting] using existing job id=${existing.id} type=${reportType}`);
        return existing.id;
      }

      const created = await reporting.jobs.create({
        requestBody: {
          reportTypeId: reportType,
          name,
        },
      });
      this.logger.log(`[Reporting] Created job id=${created.data.id} type=${reportType} (data lags 24–48h)`);
      return created.data.id || null;
    } catch (err: any) {
      this.logger.warn(`[Reporting] ensureJob(${reportType}) failed: ${err?.message || err}`);
      return null;
    }
  }

  /** Ensure a reach job exists; return jobId. */
  async ensureReachJob(userId: string): Promise<string | null> {
    return this.ensureJob(userId, this.REACH_REPORT_TYPE, 'MAE reach (thumbnail CTR)');
  }

  /**
   * List report files for a report type: paginated, filtered to the last
   * `sinceDays` days, de-duplicated per day (YouTube reissues same-day files —
   * keeping only the last one prevents double-counting impressions), capped
   * at `maxFiles`. Returns oldest-first.
   */
  async listReportFiles(
    userId: string,
    reportType: string,
    sinceDays = 7,
    maxFiles = 40,
  ): Promise<any[]> {
    const jobId = await this.ensureJob(
      userId,
      reportType,
      `MAE ${reportType}`,
    );
    if (!jobId) return [];

    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    if (!accessToken) return [];
    const reporting = this.getClient(accessToken);

    const all: any[] = [];
    let pageToken: string | undefined;
    do {
      const res: any = await reporting.jobs.reports.list({
        jobId,
        pageSize: 100,
        pageToken,
      });
      all.push(...(res.data.reports || []));
      pageToken = res.data.nextPageToken;
    } while (pageToken && all.length < 1000);

    const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
    const inWindow = all.filter(
      (r) =>
        r.downloadUrl &&
        new Date(r.startTime || 0).getTime() >= cutoff,
    );

    // Day-dedupe: same-day reissues are full replacements → keep the last one
    const byDay = new Map<string, any>();
    for (const r of inWindow) {
      byDay.set(String(r.startTime || ''), r);
    }
    const deduped = [...byDay.values()].sort((a, b) =>
      String(a.startTime || '').localeCompare(String(b.startTime || '')),
    );

    const capped = deduped.slice(-maxFiles);
    this.logger.log(
      `[Reporting] ${reportType}: files all=${all.length} inWindow(${sinceDays}d)=${inWindow.length} deduped=${deduped.length} using=${capped.length}` +
        (capped.length
          ? ` range=${capped[0].startTime}..${capped[capped.length - 1].startTime}`
          : ''),
    );
    return capped;
  }

  /**
   * Download report files and stream parsed rows to a callback (memory-safe for
   * large reports like channel_basic_a3 with country×subscribed dimensions).
   * Only the requested columns are resolved per file header.
   */
  async streamReport(
    userId: string,
    reportType: string,
    sinceDays: number,
    wantedColumns: string[],
    onRow: (date: string, values: Array<string | undefined>) => void,
    maxFiles = 40,
  ): Promise<{ files: number; missing: string[] }> {
    const files = await this.listReportFiles(userId, reportType, sinceDays, maxFiles);
    if (!files.length) return { files: 0, missing: wantedColumns };

    const accessToken = await this.youtubeService.getValidAccessToken(userId);
    if (!accessToken) return { files: 0, missing: wantedColumns };

    const missing = new Set<string>();
    let ok = 0;
    for (const report of files) {
      try {
        const res = await fetch(report.downloadUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) {
          this.logger.warn(
            `[Reporting] ${reportType} download HTTP ${res.status} for ${report.id}`,
          );
          continue;
        }
        const text = await res.text();
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) continue;
        const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
        const idx = wantedColumns.map((c) => this.findCol(header, [c]));
        idx.forEach((i, n) => {
          if (i < 0) missing.add(wantedColumns[n]);
        });
        const dateIdx = this.findCol(header, ['date', 'day']);
        for (let i = 1; i < lines.length; i++) {
          const cols = this.splitCsvLine(lines[i]);
          const date = dateIdx >= 0 ? (cols[dateIdx] || '').replace(/^"|"$/g, '') : '';
          onRow(
            date,
            idx.map((ci) => (ci >= 0 ? (cols[ci] || '').replace(/^"|"$/g, '') : undefined)),
          );
        }
        ok++;
      } catch (dlErr: any) {
        this.logger.warn(
          `[Reporting] ${reportType} download error: ${dlErr?.message || dlErr}`,
        );
      }
    }
    return { files: ok, missing: [...missing] };
  }

  /**
   * Reach rows (per video) from recent daily reports, impressions summed
   * and CTR impression-weighted across days. Optional videoId filter.
   * Window defaults to the last 7 days (same-day reissues de-duplicated).
   */
  async getReachMetrics(
    userId: string,
    videoIds?: string[],
    opts?: { sinceDays?: number; maxFiles?: number },
  ): Promise<VideoReachMetrics[]> {
    try {
      const sinceDays = opts?.sinceDays ?? 7;
      const maxFiles = opts?.maxFiles ?? 40;
      const reports = await this.listReportFiles(
        userId,
        this.REACH_REPORT_TYPE,
        sinceDays,
        maxFiles,
      );
      if (!reports.length) {
        this.logger.warn('[Reach] no report files in window (job may still be warming up — data lags 24–48h)');
        return [];
      }

      const accessToken = await this.youtubeService.getValidAccessToken(userId);
      if (!accessToken) {
        this.logger.warn('[Reach] getReachMetrics: no access token');
        return [];
      }

      this.logger.log(
        `[Reach] downloading ${reports.length} report file(s) range=${reports[0]?.startTime || '?'}..${reports[reports.length - 1]?.startTime || '?'}`,
      );

      // Merge days: sum impressions, impression-weighted CTR
      const merged = new Map<string, { impressions: number; ctrWeighted: number }>();
      let downloaded = 0;
      for (const report of reports) {
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
        `[Reach] merged rows=${out.length} files=${downloaded}/${reports.length} filter=${videoIds?.length ? videoIds.join(',') : 'none'} unit=${this.CTR_UNIT}`,
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
   * Parse reach CSV.
   * YouTube Reporting API delivers CTR as a decimal fraction (e.g. 0.02777... = 2.78%).
   * Multiplies by 100 to convert to percentage without pre-rounding, preserving precision for multi-day merge.
   */
  public parseReachCsv(csv: string, filterIds?: string[]): VideoReachMetrics[] {
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
      const ctrFraction = idx.ctr >= 0 ? Number(cols[idx.ctr] || 0) || 0 : 0;
      // Convert fraction to percentage without early rounding (e.g. 0.0277... -> 2.7777...)
      const ctr = ctrFraction * 100;
      if (!loggedSample) {
        this.logger.log(
          `[Reach] row sample video=${videoId} raw_fraction=${ctrFraction} => ctr%=${ctr.toFixed(2)}% imp=${impressions} unit=${this.CTR_UNIT} (compare vs Studio)`,
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

import { YoutubeReportingService } from './youtube-reporting.service';
import type { YouTubeService } from './youtube.service';
import type { QuotaService } from '../quota/quota.service';

describe('YoutubeReportingService - CTR parsing and conversion', () => {
  let service: YoutubeReportingService;

  beforeAll(() => {
    service = new YoutubeReportingService(
      null as unknown as YouTubeService,
      null as unknown as QuotaService,
    );
  });

  it('converts decimal fraction CTR to percentage without pre-rounding', () => {
    // 1 click out of 36 impressions: 1/36 = 0.027777777777777776 => 2.77777...%
    const csv = [
      'date,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr',
      '2026-03-25,vid1,36,0.027777777777777776',
    ].join('\n');

    const rows = service.parseReachCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].videoId).toBe('vid1');
    expect(rows[0].impressions).toBe(36);
    // Unrounded in parseReachCsv, converts 0.02777... * 100 = 2.7777...%
    expect(rows[0].ctr).toBeCloseTo(2.7777, 3);
  });

  it('preserves small CTR values that previously rounded to 0', () => {
    // 1 click out of 252 impressions: 1/252 = 0.003968253968253968 => 0.3968...%
    const csv = [
      'date,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr',
      '2026-03-25,vid2,252,0.003968253968253968',
    ].join('\n');

    const rows = service.parseReachCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].impressions).toBe(252);
    // Must NOT be rounded to 0!
    expect(rows[0].ctr).toBeGreaterThan(0.39);
    expect(rows[0].ctr).toBeLessThan(0.40);
  });

  it('preserves true 0% CTR when there are impressions but 0 clicks', () => {
    const csv = [
      'date,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr',
      '2026-03-25,vid3,34,0',
    ].join('\n');

    const rows = service.parseReachCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].impressions).toBe(34);
    expect(rows[0].ctr).toBe(0);
  });

  it('correctly calculates impression-weighted multi-day CTR', () => {
    // Simulating getReachMetrics multi-day merge:
    // Day 1: 100 impressions, 5% CTR (0.05) -> 5 clicks
    // Day 2: 200 impressions, 2% CTR (0.02) -> 4 clicks
    // Total: 300 impressions, 9 clicks -> 9 / 300 = 3.00% CTR
    // (An unweighted average would wrongly yield (5 + 2)/2 = 3.5%)
    const day1Csv = [
      'date,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr',
      '2026-03-24,vidWeighted,100,0.05',
    ].join('\n');

    const day2Csv = [
      'date,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr',
      '2026-03-25,vidWeighted,200,0.02',
    ].join('\n');

    const day1Rows = service.parseReachCsv(day1Csv);
    const day2Rows = service.parseReachCsv(day2Csv);

    const merged = new Map<string, { impressions: number; ctrWeighted: number }>();
    for (const row of [...day1Rows, ...day2Rows]) {
      const prev = merged.get(row.videoId) || { impressions: 0, ctrWeighted: 0 };
      prev.impressions += row.impressions;
      prev.ctrWeighted += row.impressions * row.ctr;
      merged.set(row.videoId, prev);
    }

    const videoResult = merged.get('vidWeighted')!;
    const finalCtr = Math.round((videoResult.ctrWeighted / videoResult.impressions) * 100) / 100;

    expect(videoResult.impressions).toBe(300);
    expect(finalCtr).toBe(3.00); // 9 / 300 = 3%
  });
});

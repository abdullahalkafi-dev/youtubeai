import { entityPattern, pickAnchors } from './daily-brain';
import { LaneVideo, pickBackup, pickFresh } from './lanes';
import { nyDayRange, OpsReportBody, opsIssues, formatOpsReport } from './ops-report';
import { renderFailure } from './renderer.service';
import { ExecError } from '../common/exec';

/** Regression tests built from the failed days of Nov 1-4, 2026 (see OPS-AUDIT.md). */

describe('topic footage is counted by the person, not by loose keywords', () => {
  const matches = (names: string[], text: string) => new RegExp(entityPattern(names)!, 'i').test(text);

  it('matches the person only as whole words', () => {
    expect(matches(["boosie's son"], 'Boosie talks about his own case')).toBe(false); // Nov 1: 293 "moments", 0 about his son
    expect(matches(['said farah'], 'Federal juror bribery and sentencing')).toBe(false); // Nov 2-3: keyword hits, no Said Farah
    expect(matches(['50 cent', 'fifty'], 'The audience disappears when the cell gets quiet — 50 Cent')).toBe(true);
    expect(matches(['ross'], 'Crossing the yard')).toBe(false);
  });

  it('has no pattern for names too short to match safely', () => {
    expect(entityPattern(['', 'ab'])).toBeNull();
  });

  it('anchors the campaign on the videos holding the passage the topic was written from', () => {
    // Nov 1: the brief came from "The audience disappears when the cell gets quiet" (zMgkKZaaOtk) but the campaign searched other videos
    const rows = [
      { youtubeId: 'W77zlu1rIKA', hits: 2, standalone: 7 },
      { youtubeId: 'zMgkKZaaOtk', hits: 4, standalone: 9 },
      { youtubeId: 'zMgkKZaaOtk', hits: 3, standalone: 8 },
      { youtubeId: 'HKFUdCt0giY', hits: 1, standalone: 9 },
      { youtubeId: 'other', hits: 1, standalone: 5 },
    ];
    expect(pickAnchors(rows)).toEqual(['zMgkKZaaOtk', 'W77zlu1rIKA', 'HKFUdCt0giY']);
    expect(pickAnchors([])).toEqual([]);
  });
});

describe('new-videos lane does not repeat the same videos every day', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const v = (id: string, over: Partial<LaneVideo> = {}): LaneVideo => ({ youtubeId: id, videoId: `db-${id}`, title: id, publishedAt: daysAgo(15), views: 15_000, durationSec: 1400, analyzed: true, strongMoments: 6, usedMoments: 0, ...over });

  it('rests the videos used on the last days while others are available', () => {
    const vids = [v('2hJu5Mq2Ckw', { views: 30_000 }), v('PI1jm_cmfx4', { views: 28_000 }), v('a'), v('b'), v('c', { views: 9_000 })];
    const out = pickFresh(vids, now, 3, new Set(['2hJu5Mq2Ckw', 'PI1jm_cmfx4']));
    expect(out.map((x) => x.youtubeId)).toEqual(['a', 'b', 'c']);
  });

  it('still uses rested videos when nothing else is left', () => {
    const out = pickFresh([v('2hJu5Mq2Ckw'), v('a')], now, 3, new Set(['2hJu5Mq2Ckw']));
    expect(out.map((x) => x.youtubeId)).toEqual(['a', '2hJu5Mq2Ckw']);
  });

  it('puts a brand-new upload ahead of an older hit with similar daily views', () => {
    const out = pickFresh([v('old-hit', { publishedAt: daysAgo(12), views: 12_000 }), v('new', { publishedAt: daysAgo(1), views: 2_500 })], now, 1);
    expect(out[0].youtubeId).toBe('new');
  });
});

describe('backup campaign for a short day', () => {
  const v = (id: string, over: Partial<LaneVideo> = {}): LaneVideo => ({ youtubeId: id, videoId: id, title: id, publishedAt: new Date('2026-08-01'), views: 20_000, durationSec: 1400, analyzed: true, strongMoments: 6, usedMoments: 0, ...over });

  it('takes analyzed videos with strong footage of any age, skipping what the day already used', () => {
    const out = pickBackup([v('used'), v('weak', { strongMoments: 2 }), v('raw', { analyzed: false }), v('new', { publishedAt: new Date('2026-11-01') }), v('old', { strongMoments: 9 })], new Set(['used']));
    expect(out.map((x) => x.youtubeId)).toEqual(['old', 'new']);
  });
});

describe('developer ops report', () => {
  const base = (): OpsReportBody => ({
    target: 5,
    made: 5,
    run: { status: 'started', reason: null, topic: 'Keefe D: Not The Shooter', fallbacks: [], backup: 'none' },
    topics: [{ name: 'Keefe D: Not The Shooter', entity: 'keefe d', footage: 61, anchors: 3, outcome: 'current' }],
    campaigns: [{ track: 'main', name: 'Daily Nov 4', status: 'completed', target: 3, reels: 3, autoTopup: false, error: null }],
    stuckSources: [],
    failedSources: [],
    downloads: { count: 2, heights: { '1080': 2 }, lowRes: 0 },
    session: { status: 'ok', cookiesUpdatedAt: new Date('2026-11-03'), lastCheckAt: new Date('2026-11-04'), lastError: null },
    renders: { failed: 0, fullscreenFallbacks: [] },
    stock: { todo: 20, queuedPosts: 5, daysLeft: 3 },
    posting: { published: 5, failed: [] },
    wasted: { promptTokens: 0, sttMinutes: 0 },
  });
  const now = new Date('2026-11-04T23:50:00Z');

  it('a healthy day has no issues', () => {
    expect(opsIssues(base(), now)).toEqual([]);
  });

  it('names what went wrong on a day like Nov 3', () => {
    const b = base();
    b.made = 0;
    b.run.fallbacks = [{ name: 'Naresh Bhatt: Archive Check First', reason: 'compose failed: No reel cleared the quality bar' }];
    b.topics = [{ name: 'Naresh Bhatt: Archive Check First', entity: 'naresh bhatt', footage: 0, anchors: 0, outcome: 'failed' }];
    b.campaigns = [{ track: 'fresh', name: 'Daily Nov 3 (new videos)', status: 'failed', target: 5, reels: 0, autoTopup: false, error: 'compose failed: weak material' }];
    b.stuckSources = [{ youtubeId: 'NBDm6H5p2co', title: 'Diddy’s Transfer', stage: 'transcribing', hours: 120, views: 15_840 }];
    b.downloads = { count: 2, heights: { '360': 2 }, lowRes: 2 };
    b.session = { status: 'ok', cookiesUpdatedAt: new Date('2026-10-17'), lastCheckAt: now, lastError: 'ERROR: [youtube] x: Sign in to confirm you’re not a bot.' };
    b.stock = { todo: 12, queuedPosts: 3, daysLeft: 1 };
    b.wasted = { promptTokens: 535_000, sttMinutes: 78 };
    const issues = opsIssues(b, now);
    expect(issues[0]).toMatch(/NO reels were made today/);
    expect(issues.join('\n')).toMatch(/no mined footage naming naresh bhatt/);
    expect(issues.join('\n')).toMatch(/NBDm6H5p2co .* stuck in transcribing for 120h/);
    expect(issues.join('\n')).toMatch(/All 2 downloads today were below 720p/);
    expect(issues.join('\n')).toMatch(/import fresh cookies/);
    expect(issues.join('\n')).toMatch(/cookies are 18 days old/);
    expect(issues.join('\n')).toMatch(/Low stock/);
    expect(issues.join('\n')).toMatch(/535k prompt tokens/);
    expect(formatOpsReport({ date: '2026-11-03', issues, body: b })).toMatch(/^=== 2026-11-03: 0\/5 reels/);
  });

  it('shows the long videos for the reels-vs-main-channel test (Nov 6)', () => {
    const b = base();
    b.target = 2;
    b.mainChannel = [{ youtubeId: 'x', title: 'El Chapo Is Locked in ADX Florence', ageDays: 7, views: 16_982, viewsPerDay: 2_426 }];
    expect(formatOpsReport({ date: '2026-11-06', issues: [], body: b })).toMatch(/main channel: El Chapo Is Locked in ADX F… d7 17k \(2\.4k\/day\)/);
  });

  it('knows where a New York day starts, also across the daylight-saving switch', () => {
    expect(nyDayRange('2026-11-04').start.toISOString()).toBe('2026-11-04T05:00:00.000Z');
    expect(nyDayRange('2026-10-31').start.toISOString()).toBe('2026-10-31T04:00:00.000Z');
    expect(nyDayRange('2026-11-01').end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });
});

describe('render failures keep the real reason', () => {
  it('keeps the error lines at the end of a long ffmpeg log', () => {
    const stderr = [...Array.from({ length: 400 }, (_, i) => `[Parsed_ass_${i} @ 0x1] Added subtitle file: 'reel.ass'`), '[Parsed_scale_371 @ 0x2] Failed to configure output pad on Parsed_scale_371', 'Error reinitializing filters!', 'Error: Invalid argument'].join('\n');
    const err = new ExecError('ffmpeg exited with code 1: ...', { code: 1, stdout: '', stderr, durationMs: 1 } as any);
    const why = renderFailure(err);
    expect(why).toMatch(/Failed to configure output pad/);
    expect(why).toMatch(/Invalid argument$/);
    expect(why).not.toMatch(/Added subtitle file/);
  });
});

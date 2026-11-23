import { YoutubeAnalyticsService } from './youtube-analytics.service';

const query = jest.fn();
jest.mock('googleapis', () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    youtubeAnalytics: () => ({ reports: { query: (...a: any[]) => query(...a) } }),
  },
}));
// One attempt only, so a failing batch does not wait for the real backoff.
jest.mock('../common/utils/retry', () => ({ retryWithBackoff: (fn: () => Promise<unknown>) => fn() }));

const row = (id: string, revenue: number) => [id, 100, 50, 20, 80, revenue];
const ids = (n: number, prefix = 'v') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

function make() {
  const quota = { logAnalyticsCall: jest.fn().mockResolvedValue(undefined) };
  const youtube = { getValidAccessToken: jest.fn().mockResolvedValue('tok') };
  return { svc: new YoutubeAnalyticsService(youtube as any, quota as any), quota };
}

describe('YoutubeAnalyticsService.getVideosAnalyticsByIds', () => {
  beforeEach(() => query.mockReset());

  it('asks for the ids in batches of 200 with a video== filter and no top-N cap', async () => {
    query.mockImplementation(async ({ filters }: any) => ({
      data: { rows: filters.replace('video==', '').split(',').map((id: string) => row(id, 1.5)) },
    }));
    const { svc } = make();
    const out = await svc.getVideosAnalyticsByIds('u1', 'UC1', ids(450));

    expect(query).toHaveBeenCalledTimes(3);
    const first = query.mock.calls[0][0];
    expect(first.ids).toBe('channel==UC1');
    expect(first.dimensions).toBe('video');
    expect(first.filters.startsWith('video==v0,v1,')).toBe(true);
    expect(first.filters.split(',')).toHaveLength(200);
    expect(query.mock.calls[2][0].filters.split(',')).toHaveLength(50);
    expect(out.size).toBe(450);
    expect(out.get('v7')).toMatchObject({ estimatedRevenue: 1.5, views: 100, averageViewPercentage: 80 });
  });

  it('skips a failed batch, keeps the others and logs the failure', async () => {
    query
      .mockResolvedValueOnce({ data: { rows: [row('a', 2)] } })
      .mockRejectedValueOnce(new Error('quota'))
      .mockResolvedValueOnce({ data: { rows: [row('c', 3)] } });
    const { svc, quota } = make();
    const out = await svc.getVideosAnalyticsByIds('u1', 'UC1', ids(401));

    expect([...out.keys()]).toEqual(['a', 'c']);
    expect(quota.logAnalyticsCall).toHaveBeenCalledWith(expect.objectContaining({ success: false, errorMessage: 'quota' }));
  });

  it('de-duplicates ids, ignores blanks, and does nothing for an empty list', async () => {
    query.mockResolvedValue({ data: { rows: [row('a', 1)] } });
    const { svc } = make();
    await svc.getVideosAnalyticsByIds('u1', 'UC1', ['a', 'a', '', 'b']);
    expect(query.mock.calls[0][0].filters).toBe('video==a,b');

    query.mockClear();
    expect((await svc.getVideosAnalyticsByIds('u1', 'UC1', [])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('a video with no row (no data yet) is simply absent', async () => {
    query.mockResolvedValue({ data: { rows: undefined } });
    const { svc } = make();
    expect((await svc.getVideosAnalyticsByIds('u1', 'UC1', ['a'])).size).toBe(0);
  });
});

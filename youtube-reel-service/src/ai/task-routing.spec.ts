import { estimateCostUsd, mergeModelTokens, modelKey, parsePairs, parsePrices, taskKind } from './task-routing';

const PRICES = parsePrices('gpt-6.1-sol=2:10,gpt-6-luna=0.1:0.5,gpt-6-astra=10:50');

describe('task routing', () => {
  it('routes by the kind before the first colon', () => {
    expect(taskKind('mining:abc123:2/5')).toBe('mining');
    expect(taskKind('daily-topic:ch:2026-10-21')).toBe('daily-topic');
    expect(taskKind('critic')).toBe('critic');
  });

  it('parses model and effort overrides, ignoring junk', () => {
    const m = parsePairs(' mining = gpt-6-luna , source-select=gpt-6-luna,,broken,=x,y= ');
    expect([...m]).toEqual([['mining', 'gpt-6-luna'], ['source-select', 'gpt-6-luna']]);
    expect(parsePairs('').size).toBe(0);
  });

  it('parses prices per 1M tokens', () => {
    expect(PRICES['gpt-6.1-sol']).toEqual({ in: 2, out: 10 });
    expect(PRICES['gpt-6-luna']).toEqual({ in: 0.1, out: 0.5 });
    expect(parsePrices('x=a:b')).toEqual({});
  });
});

describe('cost estimate', () => {
  it('an Oct 18-sized run (410k in, 136k out) costs about $2.18 on Sol and about $0.11 on Luna', () => {
    const t = { promptTokens: 410_000, completionTokens: 136_000 };
    expect(estimateCostUsd(undefined, t, PRICES, 'gpt-6.1-sol')).toBeCloseTo(2.18, 2);
    expect(estimateCostUsd({ [modelKey('gpt-6-luna')]: { prompt: 410_000, completion: 136_000 } }, t, PRICES, 'gpt-6.1-sol')).toBeCloseTo(0.109, 3);
  });

  it('prices each model on its own tokens and the unattributed rest on the default model', () => {
    const models = { [modelKey('gpt-6.1-sol')]: { prompt: 100_000, completion: 10_000 }, [modelKey('gpt-6-luna')]: { prompt: 200_000, completion: 50_000 } };
    // sol: 0.2 + 0.1 = 0.3 ; luna: 0.02 + 0.025 = 0.045 ; rest (prompt 300k total - 300k seen = 0) none
    expect(estimateCostUsd(models, { promptTokens: 300_000, completionTokens: 60_000 }, PRICES, 'gpt-6.1-sol')).toBeCloseTo(0.345, 3);
    // 50k extra prompt tokens nobody attributed are priced on Sol: +0.1
    expect(estimateCostUsd(models, { promptTokens: 350_000, completionTokens: 60_000 }, PRICES, 'gpt-6.1-sol')).toBeCloseTo(0.445, 3);
  });

  it('merges per-model tokens of a campaign and its explore part', () => {
    expect(mergeModelTokens({ a: { prompt: 1, completion: 2 } }, { a: { prompt: 10 }, b: { completion: 5 } })).toEqual({ a: { prompt: 11, completion: 2 }, b: { prompt: 0, completion: 5 } });
  });
});

import { preRoute, routeFromIntent, StudioRouter } from './studio-router';

describe('studio front-door routing', () => {
  const base = { hasTarget: false, lastAssistantWasStudio: false };
  it('answers plain questions without the studio', () => {
    expect(preRoute({ ...base, message: 'What does CTR mean?' })).toBe(
      'answer',
    );
    expect(
      preRoute({ ...base, message: 'Why do impressions matter on YouTube?' }),
    ).toBe('answer');
  });
  it('sends deliverables, pasted scripts and explicit targets to the studio', () => {
    expect(
      preRoute({ ...base, message: 'Write a script about the first night' }),
    ).toBeUndefined();
    expect(preRoute({ ...base, message: 'hi', hasTarget: true })).toBe(
      'studio',
    );
    expect(preRoute({ ...base, message: 'x'.repeat(1600) })).toBe('studio');
    expect(preRoute({ ...base, message: 'anything', skill: 'script' })).toBe(
      'studio',
    );
  });
  it('treats topic recommendations as studio work', () => {
    expect(
      preRoute({
        ...base,
        message: 'What video should I make today with high CTR?',
      }),
    ).toBe('studio');
    expect(routeFromIntent('general', 'what should I post next')).toBe(
      'studio',
    );
  });
  it('treats follow-up feedback on a studio result as studio work', () => {
    expect(
      preRoute({
        message: 'make image 2 more emotional, add tears',
        hasTarget: false,
        lastAssistantWasStudio: true,
      }),
    ).toBe('studio');
    expect(
      preRoute({
        message: 'thanks!',
        hasTarget: false,
        lastAssistantWasStudio: true,
      }),
    ).toBeUndefined();
  });
  it('maps classifier intents to a route', () => {
    expect(routeFromIntent('package', 'x')).toBe('studio');
    expect(routeFromIntent('thumbnail', 'x')).toBe('studio');
    expect(routeFromIntent('trends', 'x')).toBe('answer');
    expect(routeFromIntent('analysis', 'why did views drop')).toBe('answer');
  });

  describe('useStudio', () => {
    const thread = (last: any) => ({
      findById: () => ({
        select: () => ({ lean: async () => ({ messages: last ? [last] : [] }) }),
      }),
    });
    const studio = { enabled: jest.fn() };
    const classifier = { classify: jest.fn() };
    beforeEach(() => jest.resetAllMocks());
    it('never uses the studio on a disabled channel', async () => {
      studio.enabled.mockResolvedValue(false);
      const router = new StudioRouter(
        thread(null) as any,
        classifier as any,
        studio as any,
      );
      await expect(
        router.useStudio('t', { content: 'Write a script' } as any),
      ).resolves.toBe(false);
      expect(classifier.classify).not.toHaveBeenCalled();
    });
    it('skips the classifier for an obvious question', async () => {
      studio.enabled.mockResolvedValue(true);
      const router = new StudioRouter(
        thread(null) as any,
        classifier as any,
        studio as any,
      );
      await expect(
        router.useStudio('t', { content: 'What does CTR mean?' } as any),
      ).resolves.toBe(false);
      expect(classifier.classify).not.toHaveBeenCalled();
    });
    it('falls back to the studio when routing fails or is only a regex guess', async () => {
      studio.enabled.mockResolvedValue(true);
      const router = new StudioRouter(
        thread(null) as any,
        classifier as any,
        studio as any,
      );
      classifier.classify.mockResolvedValueOnce({
        intent: 'general',
        confidence: 0.5,
        source: 'fallback',
      });
      await expect(
        router.useStudio('t', { content: 'Give me something good' } as any),
      ).resolves.toBe(true);
      classifier.classify.mockRejectedValueOnce(new Error('down'));
      await expect(
        router.useStudio('t', { content: 'Give me something good' } as any),
      ).resolves.toBe(true);
    });
  });
});

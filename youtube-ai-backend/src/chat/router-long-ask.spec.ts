import {
  guardLongStoryFallback,
  IntentClassifierService,
  ROUTER_MAX_TOKENS,
  routerText,
} from './intent-classifier.service';
import { SkillRegistry } from './skills/skill-registry';
import { wantsDualScript } from './dual-script';

/**
 * The client dictates long asks. On Oct 31 the router's small token budget ran out on one of them, the
 * keyword fallback read the word "pictures" as an image ask, and the story came back with no bullet card.
 */

const registry: SkillRegistry = Object.create(SkillRegistry.prototype) as SkillRegistry;

// Shaped like his real Jalen Edgar rewrite: one 2,500-character paragraph, "pictures" in the middle.
const LONG_REWRITE =
  'rewrite this Jalen Edgar story I think what you wrote is two journalistic too much reporting ' +
  'I needed Unique meccaudio style to make them sit in the seat and listen. ' +
  'Jalens mother loves him she wants him home. his family has visits phone calls pictures keeping their spirits up, ' +
  'and the other parents lost their sons and they will never touch them or hear their voices again so it is hard to separate it. '.repeat(
    14,
  ) +
  'so write this up 5 to 7 minutes long make it emotional.';

describe('router on long dictated asks', () => {
  it('asks the model with a budget that covers its thinking', () => {
    expect(ROUTER_MAX_TOKENS).toBeGreaterThanOrEqual(1500);
  });

  it('sends a long message as its head and tail, a short one whole', () => {
    expect(routerText('short ask')).toBe('short ask');
    const cut = routerText(LONG_REWRITE);
    expect(cut.length).toBeLessThan(LONG_REWRITE.length);
    expect(cut.startsWith('rewrite this Jalen Edgar story')).toBe(true);
    expect(cut.endsWith('make it emotional.')).toBe(true);
  });

  it('moves a long "write this up" ask the keyword guess called an image ask to the script skill', () => {
    expect(guardLongStoryFallback(LONG_REWRITE, 'image')).toBe('script');
    expect(guardLongStoryFallback(LONG_REWRITE, 'general')).toBe('script');
  });

  it('leaves short messages, deliberate packages and thumbnails, and non-orders alone', () => {
    expect(guardLongStoryFallback('make me a picture of a cell', 'image')).toBe('image');
    expect(guardLongStoryFallback(LONG_REWRITE, 'package')).toBe('package');
    expect(guardLongStoryFallback(LONG_REWRITE, 'thumbnail')).toBe('thumbnail');
    const notAnOrder = 'I was thinking about the pictures from that case and what it says about families. '.repeat(8);
    expect(guardLongStoryFallback(notAnOrder, 'image')).toBe('image');
  });

  it('when the model fails twice, a long story order still becomes a script with both cards', async () => {
    const openai = { chatFast: jest.fn(async () => { throw new Error('400 max_tokens reached'); }) };
    const svc = new IntentClassifierService(openai as any, registry);
    const result = await svc.classify({ message: LONG_REWRITE });
    expect(openai.chatFast).toHaveBeenCalledTimes(2);
    expect(result.source).toBe('fallback');
    expect(result.intent).toBe('script');
    expect(result.freshScript).toBe(true);
    expect(wantsDualScript({ skill: 'script', userContent: LONG_REWRITE, freshScript: result.freshScript, enabled: true })).toBe(true);
  });

  it('gives the model the router budget and the shortened text', async () => {
    const openai = { chatFast: jest.fn(async () => JSON.stringify({ intent: 'script', confidence: 0.9, fresh_script: true })) };
    const svc = new IntentClassifierService(openai as any, registry);
    await svc.classify({ message: LONG_REWRITE });
    const call = (openai.chatFast.mock.calls as any[])[0][0];
    expect(call.maxCompletionTokens).toBe(ROUTER_MAX_TOKENS);
    expect(call.userMessage.length).toBeLessThan(LONG_REWRITE.length);
  });
});

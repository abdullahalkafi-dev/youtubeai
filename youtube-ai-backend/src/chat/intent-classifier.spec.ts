import { IntentClassifierService } from './intent-classifier.service';
import { SkillRegistry } from './skills/skill-registry';

/**
 * Always-LLM routing: fast-paths short-circuit the model, the model decides
 * everything else, and the regex path only runs when the model fails/times out.
 * OpenAI is mocked — no network in unit tests.
 */

interface ClassifierHost {
  classify(params: {
    message: string;
    previousAssistantMessage?: string;
  }): Promise<{
    intent: string;
    mode?: 'audit' | 'new';
    confidence: number;
    source: string;
    footage?: boolean;
    freshScript?: boolean;
  }>;
}

const registry: SkillRegistry = Object.create(
  SkillRegistry.prototype,
) as SkillRegistry;

const THUMB_HISTORY =
  '<!-- THUMBNAILS_START -->\n### Concept 1\n<!-- THUMBNAILS_END -->';

function makeClassifier(aiResponse?: () => string | Promise<string>): ClassifierHost {
  const openai = {
    chatFast: jest.fn(async () =>
      typeof aiResponse === 'function' ? aiResponse() : (aiResponse ?? '{}'),
    ),
  };
  return new IntentClassifierService(
    openai as any,
    registry,
  ) as unknown as ClassifierHost;
}

describe('IntentClassifierService', () => {
  it('routes a confident package ask with mode (LLM path)', async () => {
    const svc = makeClassifier(() =>
      JSON.stringify({ intent: 'package', mode: 'new', confidence: 0.93 }),
    );
    const result = await svc.classify({
      message: 'give me the full package for the Keefe D first night video',
    });
    expect(result.intent).toBe('package');
    expect(result.mode).toBe('new');
    expect(result.confidence).toBeCloseTo(0.93);
    expect(result.source).toBe('llm');
  });

  it('routes an audit-mode package ask (repackage existing video)', async () => {
    const svc = makeClassifier(() =>
      JSON.stringify({ intent: 'package', mode: 'audit', confidence: 0.88 }),
    );
    const result = await svc.classify({
      message: 'repackage this video, the title and thumbnail are not working',
    });
    expect(result.intent).toBe('package');
    expect(result.mode).toBe('audit');
    expect(result.source).toBe('llm');
  });

  it('never auto-fires below the confidence gate (0.8)', async () => {
    const svc = makeClassifier(() =>
      JSON.stringify({ intent: 'package', mode: 'new', confidence: 0.55 }),
    );
    const result = await svc.classify({ message: 'maybe a package?' });
    expect(result.intent).toBe('package');
    expect(result.confidence).toBeLessThan(0.8);
  });

  it('menu-selection fast-path skips the LLM entirely', async () => {
    const openai = { chatFast: jest.fn() };
    const svc = new IntentClassifierService(
      openai as any,
      registry,
    ) as unknown as ClassifierHost;
    const result = await svc.classify({
      message: 'b',
      previousAssistantMessage: 'A. SCRIPT\nB. SEO PACKAGE\nC. THUMBNAIL',
    });
    expect(result.intent).toBe('seo');
    expect(result.source).toBe('fastpath');
    expect(openai.chatFast).not.toHaveBeenCalled();
  });

  it('thumbnail-iteration fast-path skips the LLM entirely', async () => {
    const openai = { chatFast: jest.fn() };
    const svc = new IntentClassifierService(
      openai as any,
      registry,
    ) as unknown as ClassifierHost;
    const result = await svc.classify({
      message: 'make concept 2 darker',
      previousAssistantMessage: THUMB_HISTORY,
    });
    expect(result.intent).toBe('thumbnail');
    expect(result.source).toBe('fastpath');
    expect(openai.chatFast).not.toHaveBeenCalled();
  });

  it('falls back to regex when the model throws', async () => {
    const openai = {
      chatFast: jest.fn().mockRejectedValue(new Error('boom')),
    };
    const svc = new IntentClassifierService(
      openai as any,
      registry,
    ) as unknown as ClassifierHost;
    const result = await svc.classify({
      message: 'write a full script about the case',
    });
    expect(result.intent).toBe('script');
    expect(result.source).toBe('fallback');
    expect(result.confidence).toBe(0.5);
  });

  it('falls back to regex when the model returns garbage', async () => {
    const svc = makeClassifier(() => 'sorry, no json here');
    const result = await svc.classify({ message: 'seo for this video' });
    expect(result.intent).toBe('seo');
    expect(result.source).toBe('fallback');
  });

  it('rejects unknown intents from the model → regex fallback', async () => {
    const svc = makeClassifier(() =>
      JSON.stringify({ intent: 'banana', confidence: 0.99 }),
    );
    const result = await svc.classify({
      message: 'make a thumbnail for my next video',
    });
    expect(result.intent).toBe('thumbnail');
    expect(result.source).toBe('fallback');
  });

  it('clamps out-of-range confidence', async () => {
    const svc = makeClassifier(() =>
      JSON.stringify({ intent: 'script', confidence: 42 }),
    );
    const result = await svc.classify({ message: 'write a script' });
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it('strips ```json fences before parsing', async () => {
    const svc = makeClassifier(
      () =>
        '```json\n' +
        JSON.stringify({ intent: 'trends', confidence: 0.9 }) +
        '\n```',
    );
    const result = await svc.classify({ message: 'what is trending' });
    expect(result.intent).toBe('trends');
    expect(result.source).toBe('llm');
  });

  it('routes a clip request as footage (general skill), never as an AI image', async () => {
    const svc = makeClassifier(() =>
      JSON.stringify({ intent: 'footage', confidence: 0.95 }),
    );
    const result = await svc.classify({
      message: 'give me some clips from P Diddy that I could use in the background',
    });
    expect(result.intent).toBe('general');
    expect(result.footage).toBe(true);
  });

  it('keeps the script skill when the client also wants clips', async () => {
    const svc = makeClassifier(() =>
      JSON.stringify({ intent: 'script', footage: true, confidence: 0.9 }),
    );
    const result = await svc.classify({
      message: 'write up a 30 minute live and give me video for this that I could show',
    });
    expect(result.intent).toBe('script');
    expect(result.footage).toBe(true);
  });

  it('does not flag footage for a plain script ask', async () => {
    const svc = makeClassifier(() =>
      JSON.stringify({ intent: 'script', footage: false, confidence: 0.92 }),
    );
    const result = await svc.classify({ message: 'write me a script about the transfer' });
    expect(result.intent).toBe('script');
    expect(result.footage).toBeUndefined();
  });
  describe('thumbnail asks (client chat, 23 Oct)', () => {
    it('"generate thumbnail" is never routed as an AI image', async () => {
      const svc = makeClassifier(() => JSON.stringify({ intent: 'image', confidence: 0.91 }));
      const result = await svc.classify({
        message: 'generate thumbnail',
        previousAssistantMessage: 'Use this uploaded photo in Concept 1.',
      });
      expect(result.intent).toBe('thumbnail');
      expect(result.confidence).toBeCloseTo(0.91);
    });

    it('a real scene-image ask stays an image', async () => {
      const svc = makeClassifier(() => JSON.stringify({ intent: 'image', confidence: 0.9 }));
      const result = await svc.classify({ message: 'make me a cinematic prison hallway picture' });
      expect(result.intent).toBe('image');
    });

    it('a thumbnail ask that the router calls general is left to the router', async () => {
      const svc = makeClassifier(() => JSON.stringify({ intent: 'general', confidence: 0.8 }));
      const result = await svc.classify({ message: 'what should I post next and what thumbnail style works' });
      expect(result.intent).toBe('general');
    });

    it('retries once when the model returns nothing, then uses the answer', async () => {
      const answers = ['', JSON.stringify({ intent: 'thumbnail', confidence: 0.95 })];
      const svc = makeClassifier(() => answers.shift() as string);
      const result = await svc.classify({ message: 'generate me a thumbnail and here is the picture' });
      expect(result.intent).toBe('thumbnail');
      expect(result.source).toBe('llm');
    });

    it('after two empty answers an explicit thumbnail ask keeps enough confidence to auto-generate', async () => {
      const svc = makeClassifier(() => '');
      const result = await svc.classify({ message: 'generate me a thumbnail and here is the picture of John Gotti' });
      expect(result.source).toBe('fallback');
      expect(result.intent).toBe('thumbnail');
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('a vague fallback stays below the auto-image gate', async () => {
      const svc = makeClassifier(() => '');
      const result = await svc.classify({ message: 'thoughts on thumbnails in general?' });
      expect(result.confidence).toBeLessThan(0.8);
    });
  });
});

describe('fresh_script routing field', () => {
  it('passes the router answer through for a script ask', async () => {
    const fresh = makeClassifier(() => JSON.stringify({ intent: 'script', fresh_script: true, confidence: 0.9 }));
    expect((await fresh.classify({ message: 'now give me a script for this video' })).freshScript).toBe(true);
    const edit = makeClassifier(() => JSON.stringify({ intent: 'script', fresh_script: false, confidence: 0.9 }));
    expect((await edit.classify({ message: 'rewrite this in breathable blocks' })).freshScript).toBe(false);
  });

  it('leaves it undefined when the model gave none, or for other skills', async () => {
    const none = makeClassifier(() => JSON.stringify({ intent: 'script', confidence: 0.9 }));
    expect((await none.classify({ message: 'write me a script' })).freshScript).toBeUndefined();
    const other = makeClassifier(() => JSON.stringify({ intent: 'seo', fresh_script: true, confidence: 0.9 }));
    expect((await other.classify({ message: 'seo for this' })).freshScript).toBeUndefined();
  });
});

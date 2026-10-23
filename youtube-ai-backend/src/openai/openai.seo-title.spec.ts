import { OpenAIService } from './openai.service';
import { titleLength } from './prompts/title-rules';

describe('generateSeo title guard', () => {
  const details = {
    videoTitle: 'George Washington Bridge shooting story',
    videoDescription:
      'Koran Irvine, 46, a Con Edison employee, was killed on the George Washington Bridge. Retired NYPD detective Victor Romero was charged with murder after possible road rage.',
  };
  const seoJson = (title: string) => ({
    choices: [{ message: { content: JSON.stringify({ title, description: 'd', tags: ['a'], hashtags: ['#a'] }) } }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
  const rewrite = (text: string) => ({ choices: [{ message: { content: text } }] });

  function setup(...responses: any[]) {
    const ai: any = new OpenAIService(
      { get: (key: string, fallback: unknown) => (key === 'OPENAI_API_KEY' ? 'test-key' : fallback) } as never,
      {} as never,
      {} as never,
    );
    const create = jest.fn();
    for (const r of responses) {
      if (r instanceof Error) create.mockRejectedValueOnce(r);
      else create.mockResolvedValueOnce(r);
    }
    ai.client = { chat: { completions: { create } } };
    return { ai, create };
  }

  it('keeps a specific title and makes no extra call', async () => {
    const good = 'Retired NYPD Detective Charged After Road Rage Shooting of Con Ed Worker on George Washington Bridge';
    const { ai, create } = setup(seoJson(good));
    const out = await ai.generateSeo(details);
    expect(out.title).toBe(good);
    expect(out.titleVague).toBe(false);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('rewrites a vague title once so it names the incident', async () => {
    const { ai, create } = setup(
      seoJson('He Never Made It Home'),
      rewrite('Koran Irvine Killed in George Washington Bridge Road Rage Shooting'),
    );
    const out = await ai.generateSeo(details);
    expect(create).toHaveBeenCalledTimes(2);
    expect(out.title).toMatch(/Koran Irvine/);
    expect(out.titleVague).toBe(false);
  });

  it('rewrites a title over 100 characters instead of cutting it', async () => {
    const tooLong =
      'Retired NYPD Detective Charged After Road Rage Shooting of Con Ed Worker Koran Irvine on George Washington Bridge — What Happens To Both Families Now';
    const shorter = 'Retired NYPD Detective Charged in Road Rage Shooting of Koran Irvine on George Washington Bridge';
    const { ai } = setup(seoJson(tooLong), rewrite(shorter));
    const out = await ai.generateSeo(details);
    expect(out.title).toBe(shorter);
    expect(titleLength(out.title)).toBeLessThanOrEqual(100);
  });

  it('marks the title vague when the rewrite does not fix it', async () => {
    const { ai } = setup(seoJson('This Changes Everything'), rewrite('That Call Changes Everything'));
    const out = await ai.generateSeo(details);
    expect(out.titleVague).toBe(true);
  });

  it('falls back to a clean trim, never an ellipsis, when the rewrite is unavailable', async () => {
    const tooLong =
      'Retired NYPD Detective Charged After Road Rage Shooting of Con Ed Worker Koran Irvine on George Washington Bridge — What Happens To Both Families Now';
    const { ai } = setup(seoJson(tooLong), new Error('rewrite down'));
    const out = await ai.generateSeo(details);
    expect(titleLength(out.title)).toBeLessThanOrEqual(100);
    expect(out.title).not.toMatch(/\.\.\.|…/);
    expect(out.title.startsWith('Retired NYPD Detective Charged')).toBe(true);
  });
});

describe('SEO prompt title wording', () => {
  it('uses the shared rule and no longer forces 65 characters', () => {
    const { SEO_SYSTEM_PROMPT, buildSeoPrompt } = require('./prompts/seo');
    const { TITLE_CLARITY_RULE } = require('./prompts/title-rules');
    expect(SEO_SYSTEM_PROMPT).toContain(TITLE_CLARITY_RULE);
    expect(SEO_SYSTEM_PROMPT).not.toMatch(/under 65 characters/i);
    const regen = buildSeoPrompt({
      videoTitle: 'x',
      existingSeo: { title: 'Old title', tags: [] },
    }).user;
    expect(regen).toMatch(/NEW ANGLE, SAME INCIDENT/);
    expect(regen).not.toMatch(/under 65/i);
  });
});

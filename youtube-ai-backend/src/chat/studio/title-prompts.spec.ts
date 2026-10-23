import { SkillRegistry } from '../skills/skill-registry';
import {
  CREATIVE_CONTRACT,
  PACKAGE_PROMPT,
  SCRIPT_PROMPT,
  THUMBNAIL_MARKDOWN,
} from './studio.prompts';
import { CHAT_SYSTEM_PROMPT } from '../../openai/prompts/chat';
import { TITLE_CLARITY_RULE, THUMBNAIL_HEADLINE_RULE } from '../../openai/prompts/title-rules';

/**
 * Every place that writes a title must carry the same rule, and the chat thumbnail block must
 * ask for text that names the incident. The script prompt must keep its own parts untouched.
 */
describe('title and thumbnail wording is shared everywhere it matters', () => {
  const registry = new (SkillRegistry as any)(
    ...Array.from({ length: 11 }, () => ({})),
  ) as SkillRegistry;
  const prompt = (category: string) =>
    (registry as any).get(category).buildSystemPrompt({ name: 'Channel' }, {}) +
    '\n' +
    ((registry as any).get(category).getFormatInstructions?.() || '');

  it('package, SEO and general chat skills carry the title rule', () => {
    expect(prompt('package')).toContain(TITLE_CLARITY_RULE);
    expect(prompt('seo')).toContain(TITLE_CLARITY_RULE);
    expect(prompt('general')).toContain(TITLE_CLARITY_RULE);
  });

  it('the chat system prompt no longer teaches vague, lesson-style titles', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain(TITLE_CLARITY_RULE);
    expect(CHAT_SYSTEM_PROMPT).not.toMatch(/Brutal, Dark, Shocking/);
    expect(CHAT_SYSTEM_PROMPT).not.toMatch(/End with a question or consequence/);
  });

  it('the chat thumbnail block and the studio package ask for text that names the incident', () => {
    expect(THUMBNAIL_MARKDOWN).toContain(THUMBNAIL_HEADLINE_RULE);
    expect(THUMBNAIL_MARKDOWN).toMatch(/Names the incident/);
    expect(PACKAGE_PROMPT).toContain(TITLE_CLARITY_RULE);
    expect(PACKAGE_PROMPT).toContain(THUMBNAIL_HEADLINE_RULE);
  });

  it('the Bold block no longer bans naming the incident', () => {
    expect(CREATIVE_CONTRACT).not.toMatch(/no topic labels/);
    expect(CREATIVE_CONTRACT).not.toMatch(/adding something the title does not say/);
    expect(CREATIVE_CONTRACT).toMatch(/the incident in 2-5 punchy words/);
    expect(CREATIVE_CONTRACT).toMatch(/host photo is fixed/);
  });

  it('the script prompt keeps its own instructions', () => {
    const tail = SCRIPT_PROMPT.slice(CREATIVE_CONTRACT.length);
    expect(tail).toMatchSnapshot();
    expect(SCRIPT_PROMPT).toMatch(/Spoken delivery: natural clauses/);
    expect(SCRIPT_PROMPT).not.toContain(TITLE_CLARITY_RULE);
  });
});

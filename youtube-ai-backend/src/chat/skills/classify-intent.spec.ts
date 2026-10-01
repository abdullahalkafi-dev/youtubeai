import { SkillRegistry } from './skill-registry';

/**
 * Phase 1a-b regression table — intent precedence:
 *   option-select → thumbnail-iteration → thumbnail main-task → Rule 0 (topic-rec)
 *   → broad thumbnail → rest.
 * Built with the real prototype (constructor DI bypassed — classify is pure).
 */
const registry: SkillRegistry = Object.create(
  SkillRegistry.prototype,
) as SkillRegistry;

const classify = (msg: string, prev?: string) =>
  registry.classifyIntent(msg, prev);

const THUMB_HISTORY =
  '<!-- THUMBNAILS_START -->\n### Concept 1\n<!-- THUMBNAILS_END -->';

describe('classifyIntent — topic-recommendation vs thumbnail (Claude Rule 0)', () => {
  it('routes the exact client message to general (thumbnail must NOT hijack)', () => {
    const clientMsg =
      'What should I post next? Give me 1 strong topic suggestion with a title and a thumbnail package. Ground it in my recent performance and competitor data.';
    expect(classify(clientMsg)).toBe('general');
  });

  it('keeps standalone thumbnail asks as thumbnail', () => {
    expect(classify('give me a title and thumbnail for this video')).toBe(
      'thumbnail',
    );
    expect(classify('design a thumbnail for the Lil Durk verdict')).toBe(
      'thumbnail',
    );
    expect(classify('make a thumbnail for my next video')).toBe('thumbnail');
    expect(classify('3 thumbnail concepts for this case')).toBe('thumbnail');
    expect(classify('thumbnail ideas')).toBe('thumbnail');
    expect(classify('generate cover art for the video')).toBe('thumbnail');
  });

  it('Rule 0 narrow list → general', () => {
    expect(classify('what should I post next?')).toBe('general');
    expect(classify('give me a topic suggestion for tomorrow')).toBe('general');
    expect(classify('what is my next post?')).toBe('general');
    expect(classify('give me a video idea')).toBe('general');
    expect(classify('build me a content plan for this week')).toBe('general');
  });

  it('"title and thumbnail" and "ground it in" are NOT Rule 0 phrases', () => {
    // No topic-rec phrase → broad thumbnail rule wins (standalone packaging ask)
    expect(classify('give me a title and thumbnail for the Durk video')).toBe(
      'thumbnail',
    );
  });

  it('explicit scoring asks still reach the ideas skill', () => {
    expect(classify('score this video idea for me')).toBe('ideas');
    expect(classify('rate and evaluate this topic idea')).toBe('ideas');
  });

  it('keeps thumbnail-iteration override on follow-ups', () => {
    expect(classify('make concept 2 darker', THUMB_HISTORY)).toBe('thumbnail');
    expect(classify('try concept 3 lighter', THUMB_HISTORY)).toBe('thumbnail');
  });

  it('keeps other intents stable', () => {
    expect(classify('write a full script about the case')).toBe('script');
    expect(classify('generate an image of the courtroom')).toBe('image');
    expect(classify('seo for this video')).toBe('seo');
    expect(classify('what is trending right now')).toBe('trends');
  });
});

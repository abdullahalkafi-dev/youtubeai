import { buildFacebookCaption, contextLine, facebookHashtags, FACEBOOK_CAPTION_MAX, fullVideoComment, fullVideoLink } from './facebook-caption';

describe('no long dashes in the caption (client decision 2026-11-23)', () => {
  it('turns an em dash into a comma in the hook and in the context line', () => {
    const c = buildFacebookCaption({
      title: 'Yella Beezy: What leaving a prison cell is worth—Unique recalls a man',
      description: '🎥 FULL VIDEO: "x" → https://youtu.be/abc\n\nAt Lewisburg, I bit a frozen apple—and my dentures stayed in it.',
      hashtags: ['prison'],
    });
    expect(c).not.toMatch(/[—–]/);
    expect(c).toContain('worth, Unique recalls a man');
    expect(c).toContain('a frozen apple, and my dentures stayed in it.');
  });
  it('treats an en dash and spaced dashes the same way', () => {
    expect(contextLine('He waited – and waited — then left the building, finally.')).toBe('He waited, and waited, then left the building, finally.');
  });
});

describe('fullVideoLink / fullVideoComment', () => {
  const d = '🎥 FULL VIDEO: "Yella Beezy Gets Life" → https://youtu.be/IE0g7tIQGL4?t=5377\n\nAt Lewisburg, I bit a frozen apple.';
  it('finds the YouTube link, keeping the timestamp', () => {
    expect(fullVideoLink(d)).toBe('https://youtu.be/IE0g7tIQGL4?t=5377');
    expect(fullVideoLink('see https://www.youtube.com/watch?v=abc123.')).toBe('https://www.youtube.com/watch?v=abc123');
  });
  it('builds the comment text, and nothing without a YouTube link', () => {
    expect(fullVideoComment(d)).toBe('Watch the full video on YouTube: https://youtu.be/IE0g7tIQGL4?t=5377');
    expect(fullVideoComment('no link here')).toBeNull();
    expect(fullVideoComment('https://example.com/x')).toBeNull();
    expect(fullVideoComment(null)).toBeNull();
  });
});

describe('facebookHashtags', () => {
  it('keeps at most 5 clean, de-duplicated tags and never invents any', () => {
    expect(facebookHashtags(['#Prison', 'prison', 'Life Sentence!', 'a_b', '##Harlem', 'one', 'two', 'three'])).toEqual(['#Prison', '#LifeSentence', '#a_b', '#Harlem', '#one']);
    expect(facebookHashtags([])).toEqual([]);
    expect(facebookHashtags(undefined)).toEqual([]);
  });
  it('drops empty and over-long tags', () => {
    expect(facebookHashtags(['', '#', 'x'.repeat(40), 'ok'])).toEqual(['#ok']);
  });
});

describe('contextLine', () => {
  it('skips the full-video line, links and hashtag-only lines, and takes the first sentence', () => {
    const d = '🎥 FULL VIDEO: "Big story" → https://youtu.be/abc\n\nHe walked out after nine years and nobody was waiting. The cell was easier than the street.\n\n#prison #life';
    expect(contextLine(d)).toBe('He walked out after nine years and nobody was waiting.');
  });
  it('is empty when there is only a link or nothing', () => {
    expect(contextLine('https://youtu.be/abc')).toBe('');
    expect(contextLine(null)).toBe('');
  });
  it('is cut at a word boundary with an ellipsis', () => {
    const out = contextLine(`${'word '.repeat(60)}`.trim(), 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildFacebookCaption (short style)', () => {
  const title = 'Unique Mecca Audio: What leaving a prison cell is worth';
  const description = '🎥 FULL VIDEO: "x" → https://youtu.be/abc\n\nA man recalls the first night home. Nobody warned him about the silence.';

  it('is hook, one context line, then 3-5 hashtags', () => {
    const c = buildFacebookCaption({ title, description, hashtags: ['prison', 'reentry', 'harlem', 'story'] });
    expect(c).toBe('What leaving a prison cell is worth\n\nA man recalls the first night home.\n\n#prison #reentry #harlem #story');
  });

  it('never contains a link, even when the title or description has one', () => {
    const c = buildFacebookCaption({ title: 'Watch https://youtu.be/abc now', description: 'See https://example.com for more. Real line here is long enough.', hashtags: ['a'] });
    expect(c).not.toMatch(/https?:\/\//);
  });

  it('drops the context when it only repeats the hook', () => {
    const c = buildFacebookCaption({ title: 'What leaving a prison cell is worth', description: 'What leaving a prison cell is worth.', hashtags: ['prison'] });
    expect(c).toBe('What leaving a prison cell is worth\n\n#prison');
  });

  it('stays within the size cap and keeps the hook and hashtags when it must shorten', () => {
    const c = buildFacebookCaption({ title: 'Hook', description: `${'Long sentence goes on and on without end '.repeat(20)}.`, hashtags: ['one', 'two', 'three'] });
    expect(c.length).toBeLessThanOrEqual(FACEBOOK_CAPTION_MAX);
    expect(c.startsWith('Hook')).toBe(true);
    expect(c.endsWith('#one #two #three')).toBe(true);
  });

  it('is empty for an empty title with nothing else', () => {
    expect(buildFacebookCaption({ title: '  ', description: '', hashtags: [] })).toBe('');
  });
});

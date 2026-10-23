import {
  YOUTUBE_TITLE_MAX,
  capChatTitle,
  TITLE_CLARITY_RULE,
  cleanTitleText,
  extractAnchors,
  fitTitle,
  titleIsVague,
  titleLength,
} from './title-rules';

describe('title length', () => {
  it('counts characters the way YouTube does', () => {
    expect(titleLength('abc')).toBe(3);
    expect(titleLength('a😀b')).toBe(3);
  });

  it('leaves a title of exactly 100 characters alone and trims 101', () => {
    const exactly100 = 'A'.repeat(100);
    expect(fitTitle(exactly100)).toBe(exactly100);
    const over = ('Retired NYPD Detective Charged After Road Rage Shooting of Con Ed Worker on the Bridge — ' + 'x'.repeat(30)).slice(0, 101);
    expect(titleLength(fitTitle(over))).toBeLessThanOrEqual(YOUTUBE_TITLE_MAX);
  });

  it('trims a long title at a natural break, keeps the incident and never adds an ellipsis', () => {
    const long =
      'Retired NYPD Detective Charged After Road Rage Shooting of Con Ed Worker on George Washington Bridge — What Happens To Both Families Now';
    const fitted = fitTitle(long);
    expect(titleLength(long)).toBeGreaterThan(100);
    expect(titleLength(fitted)).toBeLessThanOrEqual(100);
    expect(fitted.startsWith('Retired NYPD Detective Charged After Road Rage Shooting')).toBe(true);
    expect(fitted).not.toMatch(/\.\.\.|…/);
    expect(fitted).not.toMatch(/[—:,\- ]$/);
  });

  it('counts emoji as one character when trimming', () => {
    const t = '😀'.repeat(60) + ' ' + 'word '.repeat(10);
    expect(titleLength(fitTitle(t))).toBeLessThanOrEqual(100);
  });

  it('strips markdown, quotes and angle brackets without shortening', () => {
    expect(cleanTitleText('**"Hello <world>"**')).toBe('Hello world');
  });
});

describe('vague title detection', () => {
  const bridge = extractAnchors(
    'George Washington Bridge shooting story',
    'Koran Irvine, 46, a Con Edison employee, was killed on the George Washington Bridge. Retired NYPD detective Victor Romero was charged with murder after possible road rage.',
  );

  it('flags the generic bridge thumbnail wording and the pronoun opener', () => {
    expect(titleIsVague('HE NEVER MADE IT HOME', bridge)).toBe(true);
    expect(titleIsVague('That Call Changes Everything', bridge)).toBe(true);
    expect(titleIsVague('The Pain Beyond Everything', bridge)).toBe(true);
  });

  it('accepts titles that name the incident', () => {
    expect(
      titleIsVague('Retired NYPD Detective Charged After Road Rage Shooting of Con Ed Worker on George Washington Bridge', bridge),
    ).toBe(false);
    expect(titleIsVague("Koran Irvine's Killing on the GWB", bridge)).toBe(false);
  });

  it('flags an empty title and a pronoun-only title when there is no data at all', () => {
    expect(titleIsVague('', bridge)).toBe(true);
    expect(titleIsVague('He Never Made It Home', new Set())).toBe(true);
    expect(titleIsVague('Diddy Moved To A New Prison', new Set())).toBe(false);
  });

  it('ignores channel and platform words when collecting anchors', () => {
    const anchors = extractAnchors('Hosted by Unique. Subscribe on YouTube and Instagram');
    expect(anchors.has('unique')).toBe(false);
    expect(anchors.has('youtube')).toBe(false);
  });
});

describe('the shared rule text', () => {
  it('states the hard limit, the front-loading and the no-pronoun rules', () => {
    expect(TITLE_CLARITY_RULE).toContain('100 characters');
    expect(TITLE_CLARITY_RULE).toMatch(/first ~60 characters/);
    expect(TITLE_CLARITY_RULE).toMatch(/Never use "he", "she"/);
  });
});

describe('capChatTitle', () => {
  const long =
    'Retired NYPD Detective Charged After Road Rage Shooting of Con Ed Worker on George Washington Bridge — What Happens To Both Families Now';

  it('trims only a title line that is over 100 characters', () => {
    const reply = `## RESEARCH\n- fact\n\n## Title\n\n**${long}**\n\n## Description\nBody text stays.`;
    const out = capChatTitle(reply);
    expect(out.changed).toBe(true);
    const titleLine = out.content.split('\n').find((l) => l.startsWith('**Retired'))!;
    expect(titleLength(titleLine.replace(/\*\*/g, ''))).toBeLessThanOrEqual(100);
    expect(out.content).toContain('## Description\nBody text stays.');
  });

  it('leaves a short title, replies without a title and the rest of the text alone', () => {
    const ok = '## Title\nKoran Irvine Killed on George Washington Bridge\n\n## Description\nx';
    expect(capChatTitle(ok)).toEqual({ content: ok, changed: false });
    expect(capChatTitle('no title here').changed).toBe(false);
  });

  it('also works for a ### TITLE heading', () => {
    const out = capChatTitle(`### TITLE\n${long}\n**Alternates:** B`);
    expect(out.changed).toBe(true);
    expect(out.content).toContain('**Alternates:** B');
  });
});

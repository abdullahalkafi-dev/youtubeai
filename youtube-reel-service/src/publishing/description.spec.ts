import { buildEngagementComment, stripBrandPrefix, COMMENT_MAX_CHARS, fullVideoLine, withFullVideoLine } from './description';

describe('full video line', () => {
  it('names the full video and carries its link', () => {
    expect(fullVideoLine('Lil Durk Denied Bond — What The Feds Want', 'https://youtu.be/abc?t=42')).toBe(
      '🎥 FULL VIDEO: "Lil Durk Denied Bond — What The Feds Want" → https://youtu.be/abc?t=42',
    );
  });

  it('strips quotes and angle brackets from the title and falls back without a link', () => {
    expect(fullVideoLine('He said "no" <b>', 'https://youtu.be/x')).toBe('🎥 FULL VIDEO: "He said no b" → https://youtu.be/x');
    expect(fullVideoLine('Anything', null)).toBe('🎥 Full video on the channel.');
  });
});

describe('withFullVideoLine', () => {
  const line = '🎥 FULL VIDEO: "T" → https://youtu.be/new';

  it('puts the line first', () => {
    expect(withFullVideoLine('Hook.\nLesson.', line)).toBe(`${line}\n\nHook.\nLesson.`);
  });

  it('replaces an older first line instead of stacking another', () => {
    const old = '🎥 Full video on the channel.\n\nHook.';
    expect(withFullVideoLine(old, line)).toBe(`${line}\n\nHook.`);
    expect(withFullVideoLine(`🎥 FULL VIDEO: "Old" → https://youtu.be/old\n\nHook.`, line)).toBe(`${line}\n\nHook.`);
  });

  it('moves the old last-line link to the top', () => {
    expect(withFullVideoLine('Hook.\n\nFull breakdown: https://youtu.be/old?t=3', line)).toBe(`${line}\n\nHook.`);
    expect(withFullVideoLine('Hook.\n\nFull video on the channel.', line)).toBe(`${line}\n\nHook.`);
  });
});

describe('engagement comment', () => {
  it('is the question plus where the full video is', () => {
    expect(buildEngagementComment('Would you take the plea or ride it out at trial?')).toBe(
      'Would you take the plea or ride it out at trial?\n\nFull video is in the description.',
    );
  });

  it('is skipped without a question and never exceeds the limit', () => {
    expect(buildEngagementComment('   ')).toBeNull();
    expect(buildEngagementComment(undefined)).toBeNull();
    expect(buildEngagementComment('x'.repeat(2000))!.length).toBeLessThanOrEqual(COMMENT_MAX_CHARS);
  });
});

describe('stripBrandPrefix', () => {
  it('drops the channel name used as a topic', () => {
    expect(stripBrandPrefix('Unique Mecca Audio: He asked for school after life without parole')).toBe('He asked for school after life without parole');
    expect(stripBrandPrefix('Unique Mecca Audio - prison took his daughter’s childhood')).toBe('Prison took his daughter’s childhood');
  });

  it('leaves real titles alone and never empties one', () => {
    expect(stripBrandPrefix('Diddy and isolation: Who are you without an audience?')).toBe('Diddy and isolation: Who are you without an audience?');
    expect(stripBrandPrefix('Unique Mecca Audio:')).toBe('Unique Mecca Audio:');
  });
});

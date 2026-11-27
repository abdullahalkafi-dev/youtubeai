import { nyToUtc } from './auto-plan';
import { cleanReply, dailyRemaining, gapMs, hardSkipReason, isOwnComment, isRepeat, replyPause, skipReasonOf, validateReply } from './facebook-reply-rules';

describe('hardSkipReason (what is never answered, decided without the model)', () => {
  it('lets ordinary comments through, emoji and slang included', () => {
    for (const t of ['❤️🔥🔥', 'Good looking out 👍', 'Commissary is very necessary', 'Salute my brother', 'Facts', 'How long was he in?', '👍🏾👍🏾👍🏾']) expect(hardSkipReason(t)).toBeNull();
  });
  it('skips an empty comment (a photo or sticker only)', () => {
    expect(hardSkipReason('')).toBe('no_text');
    expect(hardSkipReason('   ')).toBe('no_text');
    expect(hardSkipReason(null)).toBe('no_text');
  });
  it('skips slurs, insults and threats', () => {
    expect(hardSkipReason('All yall some bitch ass nigga yall are the same')).toBe('slur');
    expect(hardSkipReason('U a fuck boy for saying that')).toBe('abuse');
    expect(hardSkipReason('shut the fuck up')).toBe('abuse');
    expect(hardSkipReason('i will kill you and your family')).toBe('threat');
  });
  it('skips self-harm for a human, never an automatic answer', () => {
    expect(hardSkipReason('i want to die in here')).toBe('needs_care');
  });
  it('skips links, contact drops and money schemes', () => {
    expect(hardSkipReason('check out https://bit.ly/x')).toBe('spam');
    expect(hardSkipReason('great video visit mysite.com')).toBe('spam');
    expect(hardSkipReason('dm me for crypto signals')).toBe('spam');
    expect(hardSkipReason('call 555 123 4567 now')).toBe('spam');
  });
  it('skips politics and very long comments', () => {
    expect(hardSkipReason('this is all because of Trump')).toBe('politics');
    expect(hardSkipReason('a'.repeat(601))).toBe('too_long');
  });
});

describe('isOwnComment', () => {
  it('is the Page itself, or the Page link comment', () => {
    expect(isOwnComment({ id: '1', message: 'hi', from: { id: 'PAGE' } }, 'PAGE')).toBe(true);
    expect(isOwnComment({ id: '2', message: 'Watch the full video on YouTube: https://youtu.be/x' }, 'PAGE')).toBe(true);
    expect(isOwnComment({ id: '3', message: 'nice', from: { id: 'OTHER' } }, 'PAGE')).toBe(false);
    expect(isOwnComment({ id: '4', message: 'nice' }, 'PAGE')).toBe(false);
  });
});

describe('cleanReply', () => {
  it('removes dashes, links, hashtags, @names and quotes', () => {
    expect(cleanReply('Appreciate it — watch https://x.com now #facts @someone "real"')).toBe('Appreciate it, watch now real');
  });
  it('keeps one emoji only', () => {
    expect(cleanReply('Love it 🔥 thank you 🙏 truly 💯')).toBe('Love it 🔥 thank you truly');
  });
  it('cuts a long reply at a sentence or word and stays within the limit', () => {
    const long = `${'Word '.repeat(10).trim()}. ${'More words here '.repeat(20)}`;
    const out = cleanReply(long);
    expect(out.length).toBeLessThanOrEqual(180);
    expect(out.length).toBeGreaterThan(20);
  });
});

describe('validateReply', () => {
  it('passes a plain short reply', () => {
    expect(validateReply('It really is. That little bag of snacks holds a week together.', [])).toBeNull();
  });
  it('rejects what must never be posted', () => {
    expect(validateReply('', [])).toBe('empty');
    expect(validateReply('x'.repeat(181), [])).toBe('too_long');
    expect(validateReply('Check', [])).toBe('too_short');
    expect(validateReply('Watch it at https://youtu.be/x', [])).toBe('link');
    expect(validateReply('Facts — real talk', [])).toBe('dash');
    expect(validateReply('As an AI I cannot say', [])).toBe('forbidden_phrase');
    expect(validateReply('Ask Wainsworth about it', [])).toBe('forbidden_phrase');
    expect(validateReply('Call me on 212 555 0199', [])).toBe('phone_number');
    expect(validateReply('You a bitch for that', [])).toBe('unsafe_text');
  });
  it('allows only the booking number', () => {
    expect(validateReply('To book him call 1-917-680-9091.', [])).toBeNull();
    expect(validateReply('To book him call 917 680 9091.', [])).toBeNull();
    expect(validateReply('To book him call 1-917-680-9092.', [])).toBe('phone_number');
  });
  it('rejects a repeat of a recent reply, even with a changed ending', () => {
    expect(validateReply('Appreciate you watching.', ['Appreciate you watching.'])).toBe('repeat');
    expect(isRepeat('Appreciate you watching my brother', ['Appreciate you watching, thank you'])).toBe(true);
    expect(isRepeat('Love it, thank you', ['Appreciate you watching.'])).toBe(false);
  });
});

describe('timing and caps', () => {
  const d = '2026-11-27';
  it('the gap between two replies is 2 to 6 minutes, the same for the same seed and different across seeds', () => {
    const gaps = Array.from({ length: 200 }, (_, i) => gapMs(`seed-${i}`));
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(2 * 60_000);
      expect(g).toBeLessThanOrEqual(6 * 60_000);
    }
    expect(new Set(gaps).size).toBeGreaterThan(100);
    expect(gapMs('a')).toBe(gapMs('a'));
  });
  it('the daily remainder never goes below zero', () => {
    expect(dailyRemaining(10, 35)).toBe(25);
    expect(dailyRemaining(40, 35)).toBe(0);
  });
});

describe('replyPause / skipReasonOf', () => {
  const now = new Date('2026-11-27T15:00:00Z');
  it('a login or permission error pauses until reconnected; a rate or spam block pauses for 12 hours; other errors do not pause', () => {
    expect(replyPause({ kind: 'auth', message: 'x' }, now)).toMatchObject({ until: null });
    expect(replyPause({ kind: 'quota', message: 'limit' }, now)?.until?.getTime()).toBe(now.getTime() + 12 * 3_600_000);
    expect(replyPause({ kind: 'fatal', code: '368', message: 'blocked' }, now)?.until).toBeTruthy();
    expect(replyPause({ kind: 'transient', message: 'timeout' }, now)).toBeNull();
  });
  it('normalises the model skip reason', () => {
    expect(skipReasonOf('Abuse!')).toBe('abuse');
    expect(skipReasonOf('needs care')).toBe('needs_care');
    expect(skipReasonOf('')).toBe('model_skip');
  });
});

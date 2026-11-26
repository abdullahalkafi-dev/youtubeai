import { buildEpisodeMeta, buildTags, findChapterBlock, textToHtml } from './metadata';
import { mapTime } from './silence';

const DESC = `Did Yella Beezy’s baby mom leave for an NFL player?
Unique examines an unverified rumor.

• 🔥 Street Reality & Survival Lessons: Pride is not worth it.

⏱️ CHAPTERS:
0:00 - Introduction & Unverified Relationship Rumor
2:37 - A Neighborhood Recollection
5:43 - Remembering Going Home the Next Day
8:52 - The Sanford and Son Reference

📺 PREVIOUS EPISODES IN THIS SERIES:
- Part 1: Yella Beezy Bail Reduction ➡️ https://youtu.be/uvPK41e6P-E

#YellaBeezy #UniqueMeccaAudio`;

const base = { youtubeId: 'i7h9lRniZSI', title: '  Yella   Beezy’s Baby Mom? ', description: DESC, tags: ['yella beezy', 'Yella Beezy', 'prison life', 'a,b', ''] };

describe('findChapterBlock', () => {
  it('finds the CHAPTERS block that starts at 0:00', () => {
    const b = findChapterBlock(DESC.split('\n'));
    expect(b.map((c) => c.sec)).toEqual([0, 157, 343, 532]);
    expect(b[1].title).toBe('A Neighborhood Recollection');
  });
  it('reads h:mm:ss and the no-dash style', () => {
    const b = findChapterBlock(['0:00 Start', '1:20 Middle', '1:02:05 Late']);
    expect(b.map((c) => c.sec)).toEqual([0, 80, 3725]);
  });
  it('ignores timestamp-like text that is not a chapter list', () => {
    expect(findChapterBlock(['Call me at 10:30 pm', 'Studio opens 9:00 - 17:00'])).toEqual([]);
    expect(findChapterBlock(['0:00 only one', 'text'])).toEqual([]);
  });
});

describe('buildEpisodeMeta', () => {
  const opts = { mapTime: (t: number) => mapTime(t, [{ start: 100, end: 160 }]), durationSec: 560, maxTags: 10, youtubeLink: true };
  const meta = buildEpisodeMeta(base, opts);

  it('cleans the title', () => expect(meta.title).toBe('Yella Beezy’s Baby Mom?'));
  it('maps chapter times through the cuts (a 60 s cut at 100 s moves later chapters 60 s earlier)', () => {
    expect(meta.chapters.map((c) => c.startSec)).toEqual([0, 100, 283, 472]);
  });
  it('rewrites the timestamps in the description to match the trimmed audio', () => {
    expect(meta.descriptionHtml).toContain('0:00 - Introduction');
    expect(meta.descriptionHtml).toContain('1:40 - A Neighborhood Recollection');
    expect(meta.descriptionHtml).toContain('4:43 - Remembering');
    expect(meta.descriptionHtml).not.toContain('2:37');
  });
  it('puts the YouTube link first and makes links clickable', () => {
    expect(meta.descriptionHtml.startsWith('<p>▶️ Watch the video version on YouTube: <a href="https://youtu.be/i7h9lRniZSI">')).toBe(true);
    expect(meta.descriptionHtml).toContain('<a href="https://youtu.be/uvPK41e6P-E">https://youtu.be/uvPK41e6P-E</a>');
  });
  it('keeps the bullets and hashtags, one <br> per line break', () => {
    expect(meta.descriptionHtml).toContain('• 🔥 Street Reality &amp; Survival Lessons');
    expect(meta.descriptionHtml).toContain('#YellaBeezy #UniqueMeccaAudio</p>');
    expect(meta.descriptionHtml).toContain('<br><br>⏱️ CHAPTERS:<br>');
  });
  it('drops chapters that fall after the trimmed audio ends and keeps them ordered', () => {
    const short = buildEpisodeMeta(base, { ...opts, durationSec: 300 });
    expect(short.chapters.map((c) => c.startSec)).toEqual([0, 100, 283]);
  });
  it('tags: de-duplicated, comma-free, limited', () => {
    expect(meta.tags).toBe('yella beezy, prison life, a b');
    expect(buildTags(['1', '2', '3'], 2)).toBe('1, 2');
  });
  it('can leave out the YouTube link', () => {
    expect(buildEpisodeMeta(base, { ...opts, youtubeLink: false }).descriptionHtml.startsWith('<p>Did Yella')).toBe(true);
  });
  it('a video without a chapter block gives no chapters and an unchanged text', () => {
    const m = buildEpisodeMeta({ youtubeId: 'abc', title: 't', description: 'just text\nmore', tags: [] }, { ...opts, youtubeLink: false });
    expect(m.chapters).toEqual([]);
    expect(m.descriptionHtml).toBe('<p>just text<br>more</p>');
  });
});

describe('textToHtml', () => {
  it('escapes markup and keeps trailing punctuation outside the link', () => {
    expect(textToHtml('a <b> & see https://x.com/a.')).toBe('<p>a &lt;b&gt; &amp; see <a href="https://x.com/a">https://x.com/a</a>.</p>');
  });
});

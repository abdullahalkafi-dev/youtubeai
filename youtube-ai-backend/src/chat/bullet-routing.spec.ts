import { guardBulletIntent } from './intent-classifier.service';
import { wantsDualScript } from './dual-script';

/** The client's real asks from the Oct 26 Allenwood thread, as he dictated them. */
const STORY_IN_BULLETS =
  'write me a story in bullets on Puff Daddy AKA P Diddy entered into Allenwood and adjusting walking into a new environment where people already heard all the rumors and everything else about them ' +
  'and they hear about the things he did in the other Institution and him getting in trouble with all these minor things '.repeat(10);
const SAMPLE_IN_BULLETS =
  'take me a sample in the bullet form about how P Diddy is under super being watched by the prison just give me a sample how you write it with the bullets right three phases three sections';
const THIS_IN_BULLET_FORM =
  'write this story in the bullet form that I informed you in the bullets with a heading and then two bullets under each heading';

describe('bullet asks reach the script skill', () => {
  it('moves story, sample and "write this" bullet asks off outline and general', () => {
    expect(guardBulletIntent(SAMPLE_IN_BULLETS, 'outline')).toBe('script');
    expect(guardBulletIntent(THIS_IN_BULLET_FORM, 'general')).toBe('script');
    expect(guardBulletIntent(STORY_IN_BULLETS, 'outline')).toBe('script');
    expect(guardBulletIntent('write it in Outlaw bullets', 'general')).toBe('script');
  });

  it('leaves other asks and other skills alone', () => {
    expect(guardBulletIntent('give me five controversial comment questions in bullets', 'general')).toBe('general');
    expect(guardBulletIntent('give me an outline for the Diddy video', 'outline')).toBe('outline');
    expect(guardBulletIntent(SAMPLE_IN_BULLETS, 'seo')).toBe('seo');
    expect(guardBulletIntent(SAMPLE_IN_BULLETS, 'script')).toBe('script');
  });

  it('does not treat a pasted bullet script as an ask to write one', () => {
    const pasted = 'remember to write it like this, when I say bullets\n' + '**A. A claim about the story.**\n> a short spoken line\n> a short spoken line\n'.repeat(30);
    expect(guardBulletIntent(pasted, 'general')).toBe('general');
  });
});

describe('the client\'s long dictated asks still get both scripts', () => {
  it('a 1,200+ character one-paragraph ask is a request, not pasted material', () => {
    expect(STORY_IN_BULLETS.length).toBeGreaterThan(1200);
    expect(STORY_IN_BULLETS).not.toContain('\n');
    expect(wantsDualScript({ skill: 'script', userContent: STORY_IN_BULLETS, enabled: true })).toBe(true);
  });

  it('a real pasted script still does not', () => {
    const pasted = 'here is my script\n' + '> a spoken line of the pasted script that runs on\n'.repeat(40);
    expect(wantsDualScript({ skill: 'script', userContent: pasted, enabled: true })).toBe(false);
  });
});

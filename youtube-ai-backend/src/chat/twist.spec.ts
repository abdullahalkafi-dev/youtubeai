import { extractRecentTwists, extractTwist } from './twist';

const script = (title: string, line1: string, line2: string) =>
  `intro\n<!-- SCRIPT_START -->\n# SCRIPT TITLE: X\n\n## **1. THE DOOR**\n\n> Door closes.\n> Silence.\n\n[PAUSE]\n\n## **2. ${title}**\n\n> ${line1}\n> ${line2}\n> third line\n\n### **JEWEL**\n> end\n\n## **3. NEXT**\n> more\n<!-- SCRIPT_END -->\nSources`;

describe('twist extraction', () => {
  it('reads the title and first two spoken lines of point 2', () => {
    const t = extractTwist(script('THE COLD MATH', 'Three hundred dollars.', 'That was the price.'));
    expect(t).toEqual({ title: 'THE COLD MATH', opening: 'Three hundred dollars. That was the price.' });
  });

  it('ignores messages that are not scripts, and bullet scripts', () => {
    expect(extractTwist('just chat')).toBeNull();
    expect(extractTwist('<!-- BULLET_SCRIPT_START -->\n## **2. X**\n> a\n<!-- BULLET_SCRIPT_END -->')).toBeNull();
  });

  it('returns the newest twists first and respects the limit', () => {
    const msgs = [
      { role: 'assistant', content: script('OLD ONE', 'a', 'b') },
      { role: 'user', content: 'again' },
      { role: 'assistant', content: script('MIDDLE', 'c', 'd') },
      { role: 'assistant', content: script('NEWEST', 'e', 'f') },
    ];
    expect(extractRecentTwists(msgs, 2).map((t) => t.title)).toEqual(['NEWEST', 'MIDDLE']);
  });
});

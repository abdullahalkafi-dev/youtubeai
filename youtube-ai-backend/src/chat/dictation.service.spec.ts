import { BadRequestException } from '@nestjs/common';
import {
  DictationService,
  basicTidy,
  buildDictationScriptRequest,
  bulletBlocks,
  cleanBullets,
  fallbackHeading,
  keepsHisWords,
  ownBulletsCard,
  parseTidy,
  plainTidy,
  wrapLines,
} from './dictation.service';

const SPOKEN = "so the first thing is when I got to ADX they put me in a cell by myself for twenty three hours and I didn't talk to nobody for weeks";

describe('cleanBullets', () => {
  it('trims, drops empties and caps the list', () => {
    expect(cleanBullets(['  one  two ', '', '   ', 'three'])).toEqual(['one two', 'three']);
    expect(cleanBullets('nope')).toEqual([]);
    expect(cleanBullets(Array.from({ length: 60 }, (_, i) => `b${i}`))).toHaveLength(40);
  });
});

describe('keepsHisWords', () => {
  it('accepts spelling and punctuation fixes, refuses a rewrite', () => {
    expect(keepsHisWords('i went to the diddy trial and seen it', 'I went to the Diddy trial and saw it.')).toBe(true);
    expect(keepsHisWords('i went to the diddy trial and seen it', 'Fame changes how loyalty looks from a distance.')).toBe(false);
    expect(keepsHisWords('a b c', 'anything')).toBe(true);
  });
});

describe('basicTidy and fallbackHeading', () => {
  it('capital first, full stop last, nothing else touched', () => {
    expect(basicTidy('  he was alone ')).toBe('He was alone.');
    expect(basicTidy('Was he alone?')).toBe('Was he alone?');
    expect(fallbackHeading('the first thing is when I got to ADX they put me')).toBe('THE FIRST THING IS WHEN');
    expect(plainTidy(['a b c']).items[0]).toEqual({ text: 'A b c.', heading: 'A B C' });
  });
});

describe('parseTidy', () => {
  const bullets = ['when i got to adx they put me in a cell alone', 'i did not talk to nobody for weeks'];

  it('reads the model answer and keeps one item per bullet', () => {
    const raw = JSON.stringify({
      title: 'my adx story',
      items: [
        { heading: 'Alone in the cell', text: 'When I got to ADX, they put me in a cell alone.' },
        { heading: 'Weeks of silence', text: 'I did not talk to nobody for weeks.' },
      ],
    });
    const r = parseTidy('```json\n' + raw + '\n```', bullets)!;
    expect(r.title).toBe('MY ADX STORY');
    expect(r.items[0]).toEqual({ heading: 'ALONE IN THE CELL', text: 'When I got to ADX, they put me in a cell alone.' });
    expect(r.items).toHaveLength(2);
  });

  it('falls back to his own words for a bullet the model rewrote', () => {
    const raw = JSON.stringify({
      title: 't',
      items: [
        { heading: 'x', text: 'Isolation reshapes a man in ways he cannot predict.' },
        { heading: 'y', text: 'I did not talk to nobody for weeks.' },
      ],
    });
    const r = parseTidy(raw, bullets)!;
    expect(r.items[0].text).toBe('When i got to adx they put me in a cell alone.');
    expect(r.items[1].text).toBe('I did not talk to nobody for weeks.');
  });

  it('is null when the count does not match or the answer is not JSON', () => {
    expect(parseTidy(JSON.stringify({ items: [{ heading: 'a', text: 'b' }] }), bullets)).toBeNull();
    expect(parseTidy('sorry', bullets)).toBeNull();
  });
});

describe('bulletBlocks', () => {
  const flat = (blocks: string[][]) => blocks.flat().join(' ').replace(/,/g, '').replace(/\s+/g, ' ');

  it('wraps a long bullet into short lines, at most three lines a block, with the same words', () => {
    const blocks = bulletBlocks(basicTidy(SPOKEN));
    expect(flat(blocks)).toBe(basicTidy(SPOKEN).replace(/,/g, ''));
    for (const b of blocks) {
      expect(b.length).toBeLessThanOrEqual(3);
      for (const l of b) expect(l.split(/\s+/).length).toBeLessThanOrEqual(10);
    }
  });

  it('a long sentence is shared out evenly over blocks, never a lone line after a block of three', () => {
    const long = 'He told me to back up and put my hands through the slot and then they cuffed me and walked me down the hall past every cell on the tier and left me standing there for an hour in the cold.';
    const sizes = bulletBlocks(long).map((b) => b.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(2);
  });

  it('every line that is not the end of its sentence hands the thought on with a comma', () => {
    const blocks = bulletBlocks(basicTidy(SPOKEN));
    const lines = blocks.flat();
    for (const l of lines.slice(0, -1)) expect(l).toMatch(/[,;:—–.?!]$/);
    expect(lines[lines.length - 1]).toMatch(/\.$/);
  });

  it('a short bullet is one block of one line; two sentences are two blocks', () => {
    expect(bulletBlocks('He was alone.')).toEqual([['He was alone.']]);
    expect(bulletBlocks('He was alone. Nobody came.')).toEqual([['He was alone.'], ['Nobody came.']]);
  });
});

describe('wrapLines', () => {
  const DANGLE = /\b(?:and|or|but|so|because|that|to|of|in|on|at|for|with|the|a|an|my|your|you|i|they|is|was)[,]?$/i;

  it('never ends a line on "and", "the", "with" and the like, and keeps every word', () => {
    const s = "You're out for one hour and then they come back again with the same stuff and put on all these chains because that is the whole procedure.";
    const lines = wrapLines(s);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines.slice(0, -1)) expect(l.replace(/[,;:—–.?!…]$/, '')).not.toMatch(DANGLE);
    expect(lines.join(' ').replace(/,/g, '')).toBe(s.replace(/,/g, ''));
  });

  it('breaks after punctuation first and before a turn of thought second', () => {
    expect(wrapLines('When I got to ADX, they put me in a cell alone.')).toEqual(['When I got to ADX,', 'they put me in a cell alone.']);
    const lines = wrapLines('They come back again with the same chains and the whole procedure starts over again today.');
    expect(lines[0]).toBe('They come back again with the same chains,');
  });

  it('a short sentence stays one line and a short tail is not left alone', () => {
    expect(wrapLines('He was alone.')).toEqual(['He was alone.']);
    const nine = wrapLines('one two three four five six seven eight nine');
    expect(nine).toHaveLength(1);
  });

  it('every line but the last ends in punctuation', () => {
    const lines = wrapLines('They take you out to rec then they take all the chains off you and you walk around by yourself for one hour.');
    for (const l of lines.slice(0, -1)) expect(l).toMatch(/[,;:—–.?!…]$/);
    expect(lines[lines.length - 1]).toMatch(/\.$/);
  });
});

describe('ownBulletsCard', () => {
  const card = ownBulletsCard('MY ADX STORY', [
    { heading: 'ALONE IN THE CELL', text: 'When I got to ADX, they put me in a cell alone.' },
    { heading: 'WEEKS OF SILENCE', text: 'I did not talk to nobody for weeks.' },
  ]);

  it('is a bullet card with numbered sections, a wide gap and a pause between his bullets', () => {
    expect(card.startsWith('<!-- BULLET_SCRIPT_START -->')).toBe(true);
    expect(card.trimEnd().endsWith('<!-- BULLET_SCRIPT_END -->')).toBe(true);
    expect(card).toContain('# SCRIPT TITLE: MY ADX STORY');
    expect(card).toContain('## 1. ALONE IN THE CELL');
    expect(card).toContain('## 2. WEEKS OF SILENCE');
    expect(card.match(/\[PAUSE\]/g)).toHaveLength(2);
    expect(card).toMatch(/\n> When I got to ADX,\n> they put me in a cell alone\.\n\n\[PAUSE\]/);
  });

  it('carries every word he said and nothing else', () => {
    const spokenLines = card.split('\n').filter((l) => l.startsWith('> ')).map((l) => l.slice(2));
    expect(spokenLines.join(' ')).toBe('When I got to ADX, they put me in a cell alone. I did not talk to nobody for weeks.');
  });
});

describe('buildDictationScriptRequest', () => {
  it('numbers his bullets, keeps the story his and forbids outside facts and research', () => {
    const req = buildDictationScriptRequest(['one', 'two'], 'MY TITLE');
    expect(req).toContain('1. one');
    expect(req).toContain('2. two');
    expect(req).toContain('WORKING TITLE: MY TITLE');
    expect(req).toMatch(/no research/);
    expect(req).toMatch(/Do not add outside facts/);
    expect(req).toContain('<!-- SCRIPT_START -->');
  });
});

describe('DictationService', () => {
  const longScript =
    '<!-- SCRIPT_START -->\n# SCRIPT TITLE: ADX: THE QUIET\n## **1. THE DOOR**\n\n' +
    Array.from({ length: 70 }, (_, i) => `> Line number ${i} is short here`).join('\n') +
    '\n<!-- SCRIPT_END -->';

  function make(over: Partial<{ chatFast: any; chat: any; recall: any; messages: any[] }> = {}) {
    const openai: any = {
      transcribeAudio: jest.fn().mockResolvedValue('hello there'),
      chatFast: over.chatFast ?? jest.fn().mockRejectedValue(new Error('down')),
      chat: over.chat ?? jest.fn().mockResolvedValue({ content: longScript }),
    };
    const skills: any = { get: jest.fn().mockReturnValue({ buildSystemPrompt: jest.fn().mockReturnValue('SYSTEM') }) };
    const book: any = { recall: over.recall ?? jest.fn().mockResolvedValue({ block: 'MEMORY BLOCK', ids: [], fellBack: false }) };
    const threadModel: any = {
      findById: jest.fn().mockResolvedValue({ messages: over.messages ?? [] }),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    };
    return { svc: new DictationService(threadModel, openai, skills, book), openai, skills, book, threadModel };
  }

  it('transcribes a recording and refuses an empty one', async () => {
    const { svc, openai } = make();
    await expect(svc.transcribe({ buffer: Buffer.from('abc'), mimetype: 'audio/webm;codecs=opus' })).resolves.toEqual({ text: 'hello there' });
    expect(openai.transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({ filename: 'bullet.webm', mimeType: 'audio/webm;codecs=opus' }));
    await expect(svc.transcribe({ buffer: Buffer.alloc(0), mimetype: 'audio/webm' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still gives his bullets back as a card when the tidy step is down', async () => {
    const { svc } = make();
    const r = await svc.bulletsCard(['the first thing i did was nothing', 'then i waited']);
    expect(r.bulletCard).toContain('## 1. THE FIRST THING I DID');
    expect(r.bulletCard).toContain('> The first thing i did was nothing.');
    expect(r.title).toBe('MY BULLETS');
  });

  it('refuses an empty list', async () => {
    const { svc } = make();
    await expect(svc.bulletsCard([])).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.fullScript(['', ' '])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes the full script with the persona, the book memory and no research', async () => {
    const { svc, openai, book } = make();
    const r = await svc.fullScript(['alone in a cell', 'no one to talk to']);
    expect(book.recall).toHaveBeenCalled();
    const arg = openai.chat.mock.calls[0][0];
    expect(arg.systemPromptOverride).toBe('SYSTEM');
    expect(arg.dynamicContext).toContain('MEMORY BLOCK');
    expect(arg.messages[0].content).toContain('1. alone in a cell');
    expect(r.title).toBe('ADX: THE QUIET');
    expect(r.fullScript.startsWith('<!-- SCRIPT_START -->')).toBe(true);
    expect(r.fullScript.endsWith('<!-- SCRIPT_END -->')).toBe(true);
  });

  it('tells him to press Generate again when the model does not return a script', async () => {
    const { svc } = make({ chat: jest.fn().mockResolvedValue({ content: 'Sure, which story?' }) });
    await expect(svc.fullScript(['a', 'b'])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('saves the exchange into the chat: his bullet card first, the full script after it, and names an empty chat', async () => {
    const { svc, threadModel } = make();
    const r = await svc.addToThread('64b7f3f3f3f3f3f3f3f3f3f3', ['alone in a cell', 'no one to talk to']);
    expect(r.hasScript).toBe(true);
    const update = threadModel.findByIdAndUpdate.mock.calls[0][1];
    const [userMsg, assistantMsg] = update.$push.messages.$each;
    expect(userMsg.role).toBe('user');
    expect(userMsg.content).toContain('1. alone in a cell');
    expect(assistantMsg.content.indexOf('BULLET_SCRIPT_START')).toBeLessThan(assistantMsg.content.indexOf('SCRIPT_START -->\n# SCRIPT TITLE: ADX'));
    expect(assistantMsg.metadata).toMatchObject({ category: 'script', dualScript: true, dictation: true });
    expect(update.$set.title).toBe('ADX: THE QUIET');
  });

  it('keeps his bullet card when the full script fails', async () => {
    const { svc, threadModel } = make({ chat: jest.fn().mockRejectedValue(new Error('boom')) });
    const r = await svc.addToThread('64b7f3f3f3f3f3f3f3f3f3f3', ['alone in a cell']);
    expect(r.hasScript).toBe(false);
    const assistantMsg = threadModel.findByIdAndUpdate.mock.calls[0][1].$push.messages.$each[1];
    expect(assistantMsg.content).toContain('BULLET_SCRIPT_START');
    expect(assistantMsg.content).not.toContain('<!-- SCRIPT_START -->');
  });

  it('does not rename a chat that already has messages', async () => {
    const { svc, threadModel } = make({ messages: [{ role: 'user', content: 'hi' }] });
    await svc.addToThread('64b7f3f3f3f3f3f3f3f3f3f3', ['alone in a cell']);
    expect(threadModel.findByIdAndUpdate.mock.calls[0][1].$set.title).toBeUndefined();
  });
});

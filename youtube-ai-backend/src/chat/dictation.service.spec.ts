import { BadRequestException } from '@nestjs/common';
import {
  DictationService,
  acceptableCorrection,
  applyCorrections,
  basicTidy,
  buildDictationScriptRequest,
  bulletBlocks,
  cleanBullets,
  editDistance,
  fallbackHeading,
  ownBulletsCard,
  parseCorrections,
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

describe('basicTidy: only the basics, no word changes', () => {
  it('capital first, capital I, capital after a full stop, a full stop at the end', () => {
    expect(basicTidy('  he was alone ')).toBe('He was alone.');
    expect(basicTidy('Was he alone?')).toBe('Was he alone?');
    expect(basicTidy("i said it. then i left and i'm done")).toBe("I said it. Then I left and I'm done.");
  });
  it('leaves his grammar and slang exactly as he said it', () => {
    const said = "i ain't talk to nobody and they was gonna wanna see me, you know";
    expect(basicTidy(said).toLowerCase()).toBe(said.toLowerCase() + '.');
    expect(basicTidy(said)).toContain("ain't talk to nobody");
    expect(basicTidy(said)).toContain('they was gonna wanna');
    expect(basicTidy(said)).toContain('you know');
  });
});

describe('fallbackHeading: his own first words, never invented', () => {
  it('uses the first five words and marks that the bullet goes on', () => {
    expect(fallbackHeading('The first thing is when I got to ADX')).toBe('THE FIRST THING IS WHEN…');
    expect(fallbackHeading('Alone in a cell.')).toBe('ALONE IN A CELL');
    expect(fallbackHeading('')).toBe('BULLET');
  });
});

describe('acceptableCorrection: spelling fixes only', () => {
  it('accepts capitals, a missing apostrophe and a close respelling', () => {
    expect(acceptableCorrection('adx', 'ADX')).toBe(true);
    expect(acceptableCorrection('dont', "don't")).toBe(true);
    expect(acceptableCorrection('thru', 'through')).toBe(true);
    expect(acceptableCorrection('recieve', 'receive')).toBe(true);
    expect(acceptableCorrection('wrecks', 'rec')).toBe(true);
  });
  it('refuses his slang and profanity, whatever the model says', () => {
    expect(acceptableCorrection("ain't", "isn't")).toBe(false);
    expect(acceptableCorrection('wanna', 'want')).toBe(false);
    expect(acceptableCorrection('gotta', 'got')).toBe(false);
    expect(acceptableCorrection('nobody', 'anybody')).toBe(false);
    expect(acceptableCorrection('gonna', 'going')).toBe(false);
    expect(acceptableCorrection('shit', 'ship')).toBe(false);
    expect(acceptableCorrection("y'all", 'you all')).toBe(false);
  });
  it('refuses a different word, many words and a no-op', () => {
    expect(acceptableCorrection('cell', 'prison')).toBe(false);
    expect(acceptableCorrection('was', 'were')).toBe(false);
    expect(acceptableCorrection('a dx', 'ADX')).toBe(false);
    expect(acceptableCorrection('same', 'same')).toBe(false);
    expect(acceptableCorrection('', 'x')).toBe(false);
  });
  it('measures the edit distance', () => {
    expect(editDistance('thru', 'through')).toBe(3);
    expect(editDistance('same', 'same')).toBe(0);
  });
});

describe('parseCorrections', () => {
  it('reads the model JSON and drops entries for bullets that do not exist', () => {
    const raw = '```json\n{"corrections":[{"bullet":1,"from":"thru","to":"through"},{"bullet":9,"from":"a","to":"b"},{"bullet":2,"from":"","to":"x"}]}\n```';
    expect(parseCorrections(raw, 2)).toEqual([{ bullet: 1, from: 'thru', to: 'through' }]);
  });
  it('is empty for anything unusable', () => {
    expect(parseCorrections('', 2)).toEqual([]);
    expect(parseCorrections('sorry', 2)).toEqual([]);
    expect(parseCorrections('{"corrections":"none"}', 2)).toEqual([]);
  });
});

describe('applyCorrections: his words stay his', () => {
  it('fixes the spelling of the listed words and nothing else', () => {
    const said = "when i got to adx they put me thru the slot and i dont know why";
    const r = applyCorrections(said, [
      { bullet: 1, from: 'adx', to: 'ADX' },
      { bullet: 1, from: 'thru', to: 'through' },
      { bullet: 1, from: 'dont', to: "don't" },
    ]);
    expect(r.text).toBe("when i got to ADX they put me through the slot and i don't know why");
    expect(r.applied).toBe(3);
  });

  it('keeps a capital at the start of a sentence', () => {
    expect(applyCorrections('Thru the door.', [{ bullet: 1, from: 'thru', to: 'through' }]).text).toBe('Through the door.');
  });

  it('refuses a correction that touches his slang, even when the model asks for it', () => {
    const said = "i ain't talk to nobody and i wanna go";
    const r = applyCorrections(said, [
      { bullet: 1, from: "ain't", to: "didn't" },
      { bullet: 1, from: 'nobody', to: 'anybody' },
      { bullet: 1, from: 'wanna', to: 'want to' },
    ]);
    expect(r.text).toBe(said);
    expect(r.applied).toBe(0);
  });

  it('only whole words are changed, never part of another word', () => {
    expect(applyCorrections('thrust it thru', [{ bullet: 1, from: 'thru', to: 'through' }]).text).toBe('thrust it through');
  });

  it('throws away a model that wants to "fix" far more than a few misspellings', () => {
    const said = 'one two three four five six seven eight nine ten';
    const many = ['one', 'two', 'three', 'four', 'five'].map((w) => ({ bullet: 1, from: w, to: w.toUpperCase() }));
    const r = applyCorrections(said, many);
    expect(r.text).toBe(said);
    expect(r.applied).toBe(0);
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
    expect(wrapLines('one two three four five six seven eight nine')).toHaveLength(1);
  });

  it('every line but the last ends in punctuation', () => {
    const lines = wrapLines('They take you out to rec then they take all the chains off you and you walk around by yourself for one hour.');
    for (const l of lines.slice(0, -1)) expect(l).toMatch(/[,;:—–.?!…]$/);
    expect(lines[lines.length - 1]).toMatch(/\.$/);
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

  it('adds no commas of its own: the card carries exactly his punctuation', () => {
    const said = 'Me and big mike was at the Florida state prison when this dude named Tyrone come up to us talking bout he finna put hands on somebody and I told him ion care.';
    const lines = bulletBlocks(said).flat();
    expect(lines.length).toBeGreaterThan(2);
    expect(lines.join(' ')).toBe(said);
  });

  it('a short bullet is one block of one line; two sentences are two blocks', () => {
    expect(bulletBlocks('He was alone.')).toEqual([['He was alone.']]);
    expect(bulletBlocks('He was alone. Nobody came.')).toEqual([['He was alone.'], ['Nobody came.']]);
  });
});

describe('ownBulletsCard', () => {
  const card = ownBulletsCard('MY BULLETS', [
    { heading: 'WHEN I GOT TO ADX…', text: 'When I got to ADX, they put me in a cell alone.' },
    { heading: 'I DID NOT TALK TO…', text: 'I did not talk to nobody for weeks.' },
  ]);

  it('is a bullet card with numbered sections and a wide gap, and no added cue', () => {
    expect(card.startsWith('<!-- BULLET_SCRIPT_START -->')).toBe(true);
    expect(card.trimEnd().endsWith('<!-- BULLET_SCRIPT_END -->')).toBe(true);
    expect(card).toContain('# SCRIPT TITLE: MY BULLETS');
    expect(card).toContain('## 1. WHEN I GOT TO ADX…');
    expect(card).toContain('## 2. I DID NOT TALK TO…');
    expect(card).not.toContain('[PAUSE]');
    expect(card).not.toContain('[BEAT]');
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

  it('applies only the spelling fixes the model lists and keeps his slang and grammar', async () => {
    const chatFast = jest.fn().mockResolvedValue(
      JSON.stringify({
        corrections: [
          { bullet: 1, from: 'adx', to: 'ADX' },
          { bullet: 1, from: 'thru', to: 'through' },
          { bullet: 1, from: "ain't", to: "didn't" },
          { bullet: 1, from: 'nobody', to: 'anybody' },
        ],
      }),
    );
    const { svc } = make({ chatFast });
    const r = await svc.bulletsCard(["when i got to adx i ain't talk to nobody they put me thru the slot"]);
    const lines = r.bulletCard.split('\n').filter((l) => l.startsWith('> ')).map((l) => l.slice(2)).join(' ');
    expect(lines.replace(/,/g, '')).toBe("When I got to ADX I ain't talk to nobody they put me through the slot.");
    expect(r.title).toBe('MY BULLETS');
    expect(r.bulletCard).toContain('## 1. WHEN I GOT TO ADX…');
  });

  it('still gives his bullets back as a card, untouched, when the spelling check is down', async () => {
    const { svc } = make();
    const r = await svc.bulletsCard(['the first thing i did was nothing', 'then i waited']);
    expect(r.bulletCard).toContain('## 1. THE FIRST THING I DID…');
    expect(r.bulletCard).toContain('> The first thing I did was nothing.');
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

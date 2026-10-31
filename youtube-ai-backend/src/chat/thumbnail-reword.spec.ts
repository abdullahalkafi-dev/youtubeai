import { BadRequestException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { cleanRewordText, removeTextPrompt, rewordPrompt } from './thumbnail-reword';

describe('cleanRewordText', () => {
  it('uppercases and cleans the client words', () => {
    expect(cleanRewordText('  "retired cop. road rage." ')).toEqual({ text: 'RETIRED COP. ROAD RAGE.' });
    expect(cleanRewordText('**Killed** on the bridge')).toEqual({ text: 'KILLED ON THE BRIDGE' });
  });
  it('refuses empty, too long and too many words', () => {
    expect(cleanRewordText('   ')).toHaveProperty('error');
    expect(cleanRewordText('A'.repeat(111))).toHaveProperty('error');
    expect(cleanRewordText('ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE THIRTEEN FOURTEEN FIFTEEN SIXTEEN SEVENTEEN EIGHTEEN NINETEEN')).toHaveProperty('error');
    expect(cleanRewordText('ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE')).toEqual({
      text: 'ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE',
    });
  });

  it('keeps stacked lines (one box per line, line breaks or " / ") joined with " / "', () => {
    expect(cleanRewordText(['lil durk', ' offers publishing for bail ', "mom's home at stake"])).toEqual({
      text: "LIL DURK / OFFERS PUBLISHING FOR BAIL / MOM'S HOME AT STAKE",
    });
    expect(cleanRewordText('lil durk\nwhat did he put up?\nthe judge wants more')).toEqual({
      text: 'LIL DURK / WHAT DID HE PUT UP? / THE JUDGE WANTS MORE',
    });
    expect(cleanRewordText('A B / C D')).toEqual({ text: 'A B / C D' });
    expect(cleanRewordText(['', '  ', 'one line left'])).toEqual({ text: 'ONE LINE LEFT' });
  });

  it('refuses more than four lines and an empty list', () => {
    expect(cleanRewordText(['a', 'b', 'c', 'd', 'e'])).toHaveProperty('error');
    expect(cleanRewordText(['', ' '])).toHaveProperty('error');
  });
});

describe('rewordPrompt', () => {
  it('asks for the headline only and keeps the people and scene', () => {
    const p = rewordPrompt({ oldText: 'GOTTI JR. TOOK A PLEA', newText: 'FATHER VS SON', zoneRules: 'ZONES' });
    expect(p).toContain('"FATHER VS SON"');
    expect(p).toContain('GOTTI JR. TOOK A PLEA');
    expect(p).toContain('same people with the same faces');
    expect(p.endsWith('ZONES')).toBe(true);
  });

  it('names every stacked line for a three-line headline and never asks for a slash', () => {
    const p = rewordPrompt({ oldText: 'OLD / HEADLINE', newText: 'LIL DURK / WHAT DID HE PUT UP? / THE JUDGE WANTS MORE', zoneRules: 'ZONES' });
    expect(p).toContain('exactly these 3 stacked lines');
    expect(p).toContain('"LIL DURK" then "WHAT DID HE PUT UP?" then "THE JUDGE WANTS MORE"');
    expect(p).toContain('never draw a slash');
    expect(p).toContain('The old headline reads "OLD HEADLINE"');
  });

  it('with a new photo the main person changes and the rest stays', () => {
    const p = rewordPrompt({ newText: 'A B', zoneRules: 'ZONES', hasNewPhoto: true });
    expect(p).toContain('attached reference photo');
    expect(p).toContain('Keep everything else exactly as it is: the scene');
    expect(p).not.toContain('Do not redraw, restyle, move or replace any person');
  });
});

describe('removeTextPrompt', () => {
  it('asks for no lettering at all and keeps the people and scene', () => {
    const p = removeTextPrompt({ oldText: 'A / B', zoneRules: 'ZONES' });
    expect(p).toContain('Remove ALL lettering');
    expect(p).toContain('the old headline reads "A B"');
    expect(p).toContain('same people with the same faces');
    expect(p).toContain('Do not add any new text');
    expect(p.endsWith('ZONES')).toBe(true);
  });
});

describe('ChatService.rewordThumbnail', () => {
  const original = {
    id: 'img1',
    url: 'https://m/final.png',
    cleanBackgroundUrl: 'https://m/clean.png',
    conceptTitle: 'Concept 2',
    textOverlay: 'GOTTI JR. TOOK A PLEA',
    visualDescription: 'father shouting at son',
    selectedHostImage: 'default',
    logoPosition: 'top-right',
    aspectRatio: '16:9',
  };

  function service(reviews: Array<{ ok: boolean; issues: string[] }>) {
    const s: any = Object.create(ChatService.prototype);
    s.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    s.threadModel = {
      findById: jest.fn().mockResolvedValue({ _id: 't', messages: [{ role: 'assistant', metadata: { images: [original] } }] }),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    };
    s.openaiService = {
      editImageWithReference: jest
        .fn()
        .mockResolvedValueOnce({ imageUrl: 'https://m/new.png', cleanBackgroundUrl: 'https://m/new-clean.png', revisedPrompt: 'p1' })
        .mockResolvedValueOnce({ imageUrl: 'https://m/fixed.png', cleanBackgroundUrl: 'https://m/fixed-clean.png', revisedPrompt: 'p2' }),
      reviewThumbnailText: jest.fn().mockImplementation(async () => reviews.shift() ?? { ok: true, issues: [] }),
    };
    return s;
  }

  it('edits the clean picture once and keeps ratio, host and logo', async () => {
    const s = service([{ ok: true, issues: [] }]);
    const result = await s.rewordThumbnail('t', { baseImageUrl: 'https://m/final.png', text: 'father vs son' });
    expect(s.openaiService.editImageWithReference).toHaveBeenCalledTimes(1);
    const [base, prompt, opts] = s.openaiService.editImageWithReference.mock.calls[0];
    expect(base).toBe('https://m/clean.png');
    expect(prompt).toContain('"FATHER VS SON"');
    expect(opts).toMatchObject({ selectedHostImage: 'default', logoPosition: 'top-right', aspectRatio: '16:9', excludeHost: false });
    expect(result.image).toMatchObject({
      textOverlay: 'FATHER VS SON',
      conceptTitle: 'Concept 2 (reworded)',
      rewordedFrom: 'img1',
      reviewIssues: [],
    });
    expect(result.imageUrl).toBe('https://m/new.png');
    expect(s.threadModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('makes one automatic fix when the spelling is wrong, then reports what is left', async () => {
    const s = service([
      { ok: false, issues: ['Headline reads "FATHR VS SON"'] },
      { ok: false, issues: ['Headline overlaps the logo or host photo'] },
    ]);
    const result = await s.rewordThumbnail('t', { baseImageUrl: 'https://m/final.png', text: 'father vs son' });
    expect(s.openaiService.editImageWithReference).toHaveBeenCalledTimes(2);
    expect(result.imageUrl).toBe('https://m/fixed.png');
    expect(result.image.reviewIssues).toEqual(['Headline overlaps the logo or host photo']);
  });

  it('refuses empty words without touching the picture', async () => {
    const s = service([]);
    await expect(s.rewordThumbnail('t', { baseImageUrl: 'https://m/final.png', text: '  ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(s.openaiService.editImageWithReference).not.toHaveBeenCalled();
  });

  it('a picture made without the host stays without the host', async () => {
    const s = service([{ ok: true, issues: [] }]);
    await s.rewordThumbnail('t', { baseImageUrl: 'https://m/final.png', text: 'x y', selectedHostImage: 'none' });
    expect(s.openaiService.editImageWithReference.mock.calls[0][2]).toMatchObject({ excludeHost: true, selectedHostImage: 'none' });
  });
});

describe('ChatService.removeThumbnailText and multi-line reword', () => {
  const original = {
    id: 'img1', url: 'https://m/final.png', cleanBackgroundUrl: 'https://m/clean.png', conceptTitle: 'Concept 1',
    textOverlay: 'A / B / C', visualDescription: 'v', selectedHostImage: 'default', logoPosition: 'top-right', aspectRatio: '16:9',
  };
  function service() {
    const s: any = Object.create(ChatService.prototype);
    s.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    s.threadModel = {
      findById: jest.fn().mockResolvedValue({ _id: 't', messages: [{ role: 'assistant', metadata: { images: [original] } }] }),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    };
    s.openaiService = {
      editImageWithReference: jest.fn().mockResolvedValue({ imageUrl: 'https://m/new.png', cleanBackgroundUrl: 'https://m/new-clean.png', revisedPrompt: 'p' }),
      reviewThumbnailText: jest.fn().mockResolvedValue({ ok: true, issues: [] }),
    };
    return s;
  }

  it('removes the words with one AI edit of the clean picture and saves a picture with no text', async () => {
    const s = service();
    const result = await s.removeThumbnailText('t', { baseImageUrl: 'https://m/final.png' });
    expect(s.openaiService.editImageWithReference).toHaveBeenCalledTimes(1);
    const [base, prompt, opts] = s.openaiService.editImageWithReference.mock.calls[0];
    expect(base).toBe('https://m/clean.png');
    expect(prompt).toContain('Remove ALL lettering');
    expect(opts).toMatchObject({ selectedHostImage: 'default', logoPosition: 'top-right', aspectRatio: '16:9', referenceImageUrls: [] });
    expect(result.image).toMatchObject({ textOverlay: '', conceptTitle: 'Concept 1 (no words)', textRemovedFrom: 'img1' });
    expect(s.threadModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
  });

  it('a new photo goes along as the reference for the main person', async () => {
    const s = service();
    await s.removeThumbnailText('t', { baseImageUrl: 'https://m/final.png', photoUrl: 'https://m/photo.png' });
    const [, prompt, opts] = s.openaiService.editImageWithReference.mock.calls[0];
    expect(opts.referenceImageUrls).toEqual(['https://m/photo.png']);
    expect(prompt).toContain('attached reference photo');
  });

  it('rewords a three-line headline given as lines and keeps the lines in the saved picture', async () => {
    const s = service();
    const result = await s.rewordThumbnail('t', { baseImageUrl: 'https://m/final.png', lines: ['lil durk', 'what did he put up?', 'the judge wants more'], photoUrl: 'https://m/p.png' });
    const [, prompt, opts] = s.openaiService.editImageWithReference.mock.calls[0];
    expect(prompt).toContain('exactly these 3 stacked lines');
    expect(opts.referenceImageUrls).toEqual(['https://m/p.png']);
    expect(result.image.textOverlay).toBe('LIL DURK / WHAT DID HE PUT UP? / THE JUDGE WANTS MORE');
  });
});

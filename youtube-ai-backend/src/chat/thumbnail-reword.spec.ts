import { BadRequestException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { cleanRewordText, rewordPrompt } from './thumbnail-reword';

describe('cleanRewordText', () => {
  it('uppercases and cleans the client words', () => {
    expect(cleanRewordText('  "retired cop. road rage." ')).toEqual({ text: 'RETIRED COP. ROAD RAGE.' });
    expect(cleanRewordText('**Killed** on the bridge')).toEqual({ text: 'KILLED ON THE BRIDGE' });
  });
  it('refuses empty, too long and too many words', () => {
    expect(cleanRewordText('   ')).toHaveProperty('error');
    expect(cleanRewordText('A'.repeat(91))).toHaveProperty('error');
    expect(cleanRewordText('ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE THIRTEEN FOURTEEN FIFTEEN')).toHaveProperty('error');
    expect(cleanRewordText('ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE')).toEqual({
      text: 'ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT NINE TEN ELEVEN TWELVE',
    });
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

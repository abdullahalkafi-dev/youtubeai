import { ChatService } from './chat.service';
import { matchUploadedPhoto, recentChatUploads, uploadNamesOtherPerson } from './thumbnail-uploads';
import { matchOverride, nameVariants, SubjectReferenceService } from '../openai/subject-reference.service';
import { isFaceCheckRefusal } from '../openai/openai.service';

const img = (url: string) => ({ type: 'image', url });

describe('the Nov 25 lost concept: one person written two ways', () => {
  it('finds the stored photo whichever way the model wrote the name', async () => {
    const stored: Record<string, string> = {
      'yella beezy': 'https://stored/yella.jpg',
      'markies conway': 'https://stored/markies.jpg',
    };
    const model: any = {
      findOne: jest.fn(async (q: any) => {
        for (const c of q.$or) {
          const photo = stored[c.canonicalName];
          if (photo) return { imageUrl: photo, source: 'wikipedia', verified: true };
        }
        return null;
      }),
      updateOne: jest.fn().mockReturnValue({ catch: () => undefined }),
    };
    const ai: any = { chatWithSearch: jest.fn() };
    const service = new SubjectReferenceService({} as any, ai, {} as any, model);
    for (const written of [
      'Yella Beezy',
      'Yella Beezy (Markies Deandre Conway)',
      'Markies Deandre Conway (Yella Beezy)',
      'Markies Conway',
    ]) {
      const found = await service.searchSubjectPublicImage(written);
      expect(found?.imageUrl).toMatch(/^https:\/\/stored\//);
    }
    expect(ai.chatWithSearch).not.toHaveBeenCalled(); // never fell through to a web search that finds nothing
  });

  it('does not join two different people who share only a surname or a first name', () => {
    expect(nameVariants('Kewon White')).not.toContain('White');
    expect(nameVariants('Walter White')).not.toContain('Kewon White');
    expect(nameVariants('John Gotti Jr.')).toEqual(['John Gotti Jr.']);
  });
});

describe('a photo the client saved for a person is found under any written form of the name', () => {
  const saved = [{ name: 'Yella Beezy', url: 'https://saved/yella.jpg' }];
  it('matches the alias, the legal name and a middle name', () => {
    expect(matchOverride('Yella Beezy (Markies Deandre Conway)', saved)?.url).toBe('https://saved/yella.jpg');
    expect(matchOverride('Yella Beezy', saved)?.url).toBe('https://saved/yella.jpg');
  });
  it('a shared surname alone is not the same person', () => {
    expect(matchOverride('Walter White', [{ name: 'Kewon White', url: 'u' }])).toBeUndefined();
  });
  it('never gives the senior’s photo to the junior or the reverse', () => {
    expect(matchOverride('John Gotti Jr.', [{ name: 'John Gotti', url: 'sr' }])).toBeUndefined();
    expect(matchOverride('John Gotti', [{ name: 'John Gotti Jr.', url: 'jr' }])).toBeUndefined();
  });
});

describe('the client’s loosely typed or dictated names', () => {
  const nov25 = [
    {
      role: 'user',
      content:
        'use this picture to make the thumbnail and make yellow busy with a bald head and in a prison jumpsuit orange jumpsuit [Image uploaded: Screenshot_2026-11-13_213025.png]',
      metadata: { attachments: [img('https://m/portrait.png')] },
    },
    { role: 'assistant', content: 'Got it' },
    {
      role: 'user',
      content: "generate thumbnail use that picture and the picture of his girlfriend that I'm getting ready to put in [Image uploaded: b.png]",
      metadata: { attachments: [img('https://m/couple.png')] },
    },
  ];

  it('"yellow busy" is Yella Beezy, and the couple photo is not taken as his face', () => {
    const uploads = recentChatUploads(nov25);
    expect(matchUploadedPhoto('Yella Beezy', uploads)?.url).toBe('https://m/portrait.png');
    expect(matchUploadedPhoto('Yella Beezy (Markies Deandre Conway)', uploads)?.url).toBe('https://m/portrait.png');
  });

  it('with one person missing, "use this picture" is enough even if the name is badly mangled', () => {
    const uploads = recentChatUploads([
      { role: 'user', content: 'this is the picture of him, use this', metadata: { attachments: [img('https://m/only.png')] } },
    ]);
    expect(matchUploadedPhoto('Yella Beezy', uploads)).toBeUndefined();
    expect(matchUploadedPhoto('Yella Beezy', uploads, { onlyMissingPerson: true })?.url).toBe('https://m/only.png');
  });

  it('two photos both introduced as "this is" are a guess, so none is taken', () => {
    const uploads = recentChatUploads([
      { role: 'user', content: 'this is him', metadata: { attachments: [img('https://m/1.png')] } },
      { role: 'user', content: "that's the other one", metadata: { attachments: [img('https://m/2.png')] } },
    ]);
    expect(matchUploadedPhoto('Yella Beezy', uploads, { onlyMissingPerson: true })).toBeUndefined();
  });

  it('a message that names two people is not the photo of the second one', () => {
    const upload = { url: 'u', text: 'this is yellow busy and Kewon White' };
    expect(uploadNamesOtherPerson('Yella Beezy', 'Kewon White', upload)).toBe(true);
    expect(uploadNamesOtherPerson('John Gotti Sr.', 'John Gotti Jr.', { url: 'u', text: 'John Gotti senior' })).toBe(false);
  });
});

describe('face review: "I can’t determine" is no answer, not a different person', () => {
  it('treats refusals as unknown and real differences as differences', () => {
    expect(isFaceCheckRefusal('I can’t determine whether two images show the same real person based on their faces.')).toBe(true);
    expect(isFaceCheckRefusal("I can't tell if these are the same person")).toBe(true);
    expect(isFaceCheckRefusal('Unable to compare faces of real people')).toBe(true);
    expect(isFaceCheckRefusal('The jaw, nose and skin tone clearly belong to a different, older man')).toBe(false);
    expect(isFaceCheckRefusal('')).toBe(false);
  });
});

describe('generation for the Nov 25 chat', () => {
  function service(people: any[], messages: any[], overrides: any[] = []) {
    const s: any = Object.create(ChatService.prototype);
    s.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    s.threadModel = {
      findById: jest.fn().mockResolvedValue({ _id: 't', channelId: 'c', title: 'Yella Beezy', messages }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    s.videoModel = { findById: jest.fn() };
    s.creatorPreferencesModel = { findOne: () => ({ select: () => ({ lean: async () => ({ identityReferences: overrides }) }) }) };
    s.subjectReferenceService = { resolveSubjects: jest.fn().mockResolvedValue(people) };
    s.openaiService = {
      generateThumbnailImage: jest.fn().mockResolvedValue({ imageUrl: 'https://img/final.png', cleanBackgroundUrl: 'https://img/clean.png', revisedPrompt: '' }),
      extractStoryContextFromThread: jest.fn().mockResolvedValue(''),
      reviewThumbnailText: jest.fn().mockResolvedValue({ ok: true, issues: [] }),
      reviewThumbnailLikeness: jest.fn().mockResolvedValue({ ok: true }),
      isBoldV2Enabled: () => true,
    };
    return s;
  }
  const dto = { text: 'YELLA BEEZY / GETS LIFE WITHOUT PAROLE / MUST HIS GIRL WAIT FOREVER?', visual: 'Yella Beezy only', colors: '', messageId: '6b070b52b481e33e7baad391', conceptTitle: 'Concept 1' };
  const upload = [
    {
      role: 'user',
      content: 'use this picture to make the thumbnail and make yellow busy with a bald head [Image uploaded: p.png]',
      metadata: { attachments: [img('https://m/portrait.png')] },
    },
  ];

  it('a concept with no stored photo uses the photo he sent, instead of stopping', async () => {
    const s = service([{ name: 'Yella Beezy (Markies Deandre Conway)', role: 'Defendant', photoStatus: 'missing' }], upload);
    const result = await s.generateThumbnailImage('t', dto);
    expect(result.needsPhoto).toBeUndefined();
    expect(s.openaiService.generateThumbnailImage.mock.calls[0][0].referenceImageUrls).toEqual(['https://m/portrait.png']);
  });

  it('the photo he sent and named wins over a stored public photo', async () => {
    const s = service([{ name: 'Yella Beezy', role: 'Defendant', imageUrl: 'https://stored/yella.jpg', photoStatus: 'verified' }], upload);
    await s.generateThumbnailImage('t', dto);
    expect(s.openaiService.generateThumbnailImage.mock.calls[0][0].referenceImageUrls).toEqual(['https://m/portrait.png']);
  });

  it('but a stored photo is kept when the upload names a different person', async () => {
    const s = service(
      [
        { name: 'Yella Beezy', role: 'Defendant', imageUrl: 'https://stored/yella.jpg', photoStatus: 'verified' },
        { name: 'Kewon White', role: 'Co-defendant', imageUrl: 'https://stored/kewon.jpg', photoStatus: 'verified' },
      ],
      [{ role: 'user', content: 'this is yellow busy and Kewon White', metadata: { attachments: [img('https://m/two.png')] } }],
    );
    await s.generateThumbnailImage('t', dto);
    expect(s.openaiService.generateThumbnailImage.mock.calls[0][0].referenceImageUrls).toEqual([
      'https://stored/yella.jpg',
      'https://stored/kewon.jpg',
    ]);
  });

  it('when a photo is truly missing it says so on the message, so a reload still shows why', async () => {
    const s = service([{ name: 'Yella Beezy', role: 'Defendant', photoStatus: 'missing' }], [{ role: 'user', content: 'make a thumbnail' }]);
    const result = await s.generateThumbnailImage('t', dto);
    expect(result.needsPhoto).toEqual([{ name: 'Yella Beezy', role: 'Defendant' }]);
    const update = s.threadModel.updateOne.mock.calls.find((c: any[]) => c[1].$set);
    expect(update[1].$set).toEqual({
      'messages.$.metadata.waitingPhotos.concept_1': [{ name: 'Yella Beezy', role: 'Defendant' }],
    });
  });

  it('and clears that note when the concept finally gets its image', async () => {
    const s = service([{ name: 'Yella Beezy', role: 'Defendant', imageUrl: 'https://stored/yella.jpg', photoStatus: 'verified' }], [{ role: 'user', content: 'x' }]);
    await s.generateThumbnailImage('t', dto);
    const save = s.threadModel.updateOne.mock.calls.find((c: any[]) => c[1].$push);
    expect(save[1].$unset).toEqual({ 'messages.$.metadata.waitingPhotos.concept_1': 1 });
  });
});

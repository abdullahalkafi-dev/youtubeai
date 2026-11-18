import { ChatService } from './chat.service';

/**
 * Thumbnails made by the safety fallback carry their headline as live text over a text-free picture.
 * They are marked `localHeadline`; only marked images take the local paths below. Every other image
 * must keep using exactly the paths it always used.
 */
describe('safety-fallback thumbnails (localHeadline)', () => {
  const fallbackImage = {
    id: 'img-fb',
    url: 'https://m/final.png',
    cleanBackgroundUrl: 'https://m/clean.png',
    conceptTitle: 'Concept 1',
    textOverlay: 'TUPAC SHAKUR / KILLED AT JUST 25 / WHO WOULD HE BE TODAY?',
    visualDescription: 'v',
    selectedHostImage: 'host_3.png',
    logoPosition: 'top-right',
    aspectRatio: '16:9',
    localHeadline: true,
  };
  const normalImage = { ...fallbackImage, id: 'img-normal', localHeadline: undefined };

  function service(image: any) {
    const s: any = Object.create(ChatService.prototype);
    s.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    s.threadModel = {
      findById: jest.fn().mockResolvedValue({ _id: 't', messages: [{ role: 'assistant', metadata: { images: [image] } }] }),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    };
    s.composerService = {
      composeStudioThumbnail: jest.fn().mockResolvedValue({ buffer: Buffer.from('studio'), issues: [] }),
      composeThumbnail: jest.fn().mockResolvedValue(Buffer.from('plain')),
      fetchBufferFromUrl: jest.fn().mockResolvedValue(Buffer.from('host')),
    };
    s.minioService = {
      isAvailable: jest.fn().mockResolvedValue(true),
      uploadThumbnail: jest.fn().mockImplementation(async (_b: string, name: string) => `https://m/${name}`),
    };
    s.openaiService = {
      editImageWithReference: jest.fn().mockResolvedValue({ imageUrl: 'https://m/ai.png', cleanBackgroundUrl: 'https://m/ai-clean.png', revisedPrompt: 'p' }),
      reviewThumbnailText: jest.fn().mockResolvedValue({ ok: true, issues: [] }),
    };
    return s;
  }

  describe('recompose (host / logo change)', () => {
    it('a fallback image draws its headline again', async () => {
      const s = service(fallbackImage);
      const result = await s.recomposeThumbnailOverlay('t', { baseImageUrl: 'https://m/final.png', selectedHostImage: 'host_5.png', logoPosition: 'none' });
      expect(s.composerService.composeStudioThumbnail).toHaveBeenCalledTimes(1);
      expect(s.composerService.composeThumbnail).not.toHaveBeenCalled();
      const call = s.composerService.composeStudioThumbnail.mock.calls[0][0];
      expect(call).toMatchObject({
        backgroundInput: 'https://m/clean.png',
        text: fallbackImage.textOverlay,
        textSide: 'left',
        selectedHostImage: 'host_5.png',
        logoPosition: 'none',
        excludeLogo: true,
        aspectRatio: '16:9',
      });
      expect(result.image.localHeadline).toBe(true);
    });

    it('a normal image still takes the original path and is not marked', async () => {
      const s = service(normalImage);
      const result = await s.recomposeThumbnailOverlay('t', { baseImageUrl: 'https://m/final.png', selectedHostImage: 'host_5.png' });
      expect(s.composerService.composeThumbnail).toHaveBeenCalledTimes(1);
      expect(s.composerService.composeStudioThumbnail).not.toHaveBeenCalled();
      expect(result.image.localHeadline).toBeUndefined();
    });
  });

  describe('reword', () => {
    it('a fallback image is reworded locally: no AI call, new words drawn, marker kept', async () => {
      const s = service(fallbackImage);
      const result = await s.rewordThumbnail('t', { baseImageUrl: 'https://m/final.png', lines: ['tupac shakur', 'never got older', 'who would he be today?'] });
      expect(s.openaiService.editImageWithReference).not.toHaveBeenCalled();
      expect(s.openaiService.reviewThumbnailText).not.toHaveBeenCalled();
      const call = s.composerService.composeStudioThumbnail.mock.calls[0][0];
      expect(call.text).toBe('TUPAC SHAKUR / NEVER GOT OLDER / WHO WOULD HE BE TODAY?');
      expect(call.backgroundInput).toBe('https://m/clean.png');
      expect(call.selectedHostImage).toBe('host_3.png');
      expect(result.image).toMatchObject({
        textOverlay: 'TUPAC SHAKUR / NEVER GOT OLDER / WHO WOULD HE BE TODAY?',
        conceptTitle: 'Concept 1 (reworded)',
        rewordedFrom: 'img-fb',
        localHeadline: true,
        cleanBackgroundUrl: 'https://m/clean.png',
      });
      expect(s.threadModel.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    });

    it('a fallback image with a replacement photo still goes to the AI path', async () => {
      const s = service(fallbackImage);
      await s.rewordThumbnail('t', { baseImageUrl: 'https://m/final.png', text: 'new words', photoUrl: 'https://p/new.jpg' });
      expect(s.openaiService.editImageWithReference).toHaveBeenCalled();
      expect(s.composerService.composeStudioThumbnail).not.toHaveBeenCalled();
    });

    it('a normal image is reworded by the AI exactly as before', async () => {
      const s = service(normalImage);
      await s.rewordThumbnail('t', { baseImageUrl: 'https://m/final.png', text: 'new words' });
      expect(s.openaiService.editImageWithReference).toHaveBeenCalledTimes(1);
      expect(s.composerService.composeStudioThumbnail).not.toHaveBeenCalled();
    });
  });

  describe('remove the words', () => {
    it('a fallback image is redrawn without words, with no AI call', async () => {
      const s = service(fallbackImage);
      const result = await s.removeThumbnailText('t', { baseImageUrl: 'https://m/final.png' });
      expect(s.openaiService.editImageWithReference).not.toHaveBeenCalled();
      expect(s.composerService.composeStudioThumbnail).not.toHaveBeenCalled();
      const call = s.composerService.composeThumbnail.mock.calls[0][0];
      expect(call).toMatchObject({ backgroundInput: 'https://m/clean.png', selectedHostImage: 'host_3.png', aspectRatio: '16:9' });
      expect(result.image).toMatchObject({ textOverlay: '', textRemovedFrom: 'img-fb', conceptTitle: 'Concept 1 (no words)' });
      expect(result.image.localHeadline).toBeUndefined();
    });

    it('a normal image is cleaned by the AI exactly as before', async () => {
      const s = service(normalImage);
      await s.removeThumbnailText('t', { baseImageUrl: 'https://m/final.png' });
      expect(s.openaiService.editImageWithReference).toHaveBeenCalledTimes(1);
      expect(s.composerService.composeThumbnail).not.toHaveBeenCalled();
    });
  });

  describe('generate: the marker and the skipped AI reviews', () => {
    function generator(openaiResult: any) {
      const s: any = Object.create(ChatService.prototype);
      s.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
      s.threadModel = {
        findById: jest.fn().mockResolvedValue({ _id: 't', channelId: 'c', title: 'Tupac live', messages: [] }),
        updateOne: jest.fn(),
      };
      s.videoModel = { findById: jest.fn() };
      s.creatorPreferencesModel = { findOne: () => ({ select: () => ({ lean: async () => null }) }) };
      s.subjectReferenceService = {
        resolveSubjects: jest.fn().mockResolvedValue([{ name: 'Tupac Shakur', role: 'Subject', imageUrl: 'https://p/tupac.jpg', photoStatus: 'verified' }]),
      };
      s.openaiService = {
        generateThumbnailImage: jest.fn().mockResolvedValue(openaiResult),
        extractStoryContextFromThread: jest.fn().mockResolvedValue(''),
        isBoldV2Enabled: jest.fn().mockReturnValue(true),
        reviewThumbnailLikeness: jest.fn().mockResolvedValue({ ok: true }),
        reviewThumbnailText: jest.fn().mockResolvedValue({ ok: true, issues: [] }),
        editImageWithReference: jest.fn(),
      };
      return s;
    }
    const dto = { text: 'TUPAC SHAKUR / KILLED AT JUST 25 / WHO SPEAKS FOR HIM NOW?', visual: 'x', colors: '', conceptTitle: 'Concept 2' };

    it('marks a fallback image, skips both AI reviews and tells the client', async () => {
      const s = generator({ imageUrl: 'https://m/f.png', cleanBackgroundUrl: 'https://m/c.png', revisedPrompt: 'p', safetyFallback: 'photo' });
      const result = await s.generateThumbnailImage('t', dto);
      expect(result.image.localHeadline).toBe(true);
      expect(result.image.reviewIssues).toHaveLength(1);
      expect(result.image.reviewIssues[0]).toMatch(/safety filter/);
      expect(s.openaiService.reviewThumbnailLikeness).not.toHaveBeenCalled();
      expect(s.openaiService.reviewThumbnailText).not.toHaveBeenCalled();
      expect(s.openaiService.editImageWithReference).not.toHaveBeenCalled();
    });

    it('a normal image is not marked and still gets both reviews', async () => {
      const s = generator({ imageUrl: 'https://m/n.png', cleanBackgroundUrl: 'https://m/c.png', revisedPrompt: 'p' });
      const result = await s.generateThumbnailImage('t', dto);
      expect(result.image.localHeadline).toBeUndefined();
      expect(result.image.reviewIssues).toEqual([]);
      expect(s.openaiService.reviewThumbnailLikeness).toHaveBeenCalledTimes(1);
      expect(s.openaiService.reviewThumbnailText).toHaveBeenCalledTimes(1);
    });
  });
});

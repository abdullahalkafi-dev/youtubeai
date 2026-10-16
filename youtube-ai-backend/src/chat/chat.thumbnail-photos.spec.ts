import { ChatService } from './chat.service';
import { OpenAIService } from '../openai/openai.service';

describe('legacy thumbnails never invent real people', () => {
  function chatService(people: any[]) {
    const service: any = Object.create(ChatService.prototype);
    service.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    service.threadModel = {
      findById: jest.fn().mockResolvedValue({
        _id: 't',
        channelId: 'c',
        title: 'Choosing Today’s Video Topic',
        messages: [],
      }),
    };
    service.videoModel = { findById: jest.fn() };
    service.creatorPreferencesModel = {
      findOne: () => ({ select: () => ({ lean: async () => null }) }),
    };
    service.subjectReferenceService = {
      resolveSubjects: jest.fn().mockResolvedValue(people),
    };
    service.openaiService = {
      generateThumbnailImage: jest.fn(),
      extractStoryContextFromThread: jest.fn().mockResolvedValue(''),
      reviewThumbnailText: jest.fn().mockResolvedValue({ ok: true, issues: [] }),
    };
    return service;
  }

  it('asks the client for a photo instead of generating when a required face is missing', async () => {
    const service = chatService([
      { name: 'Latrina Ashburne', role: 'Victim', imageUrl: 'https://p/a.jpg', photoStatus: 'verified' },
      { name: 'Matthew Hightower', role: 'Defendant', photoStatus: 'missing' },
    ]);
    const result = await service.generateThumbnailImage('t', {
      text: 'HIS PLOT KILLED THE WRONG WOMAN',
      visual: 'Matthew Hightower large on the left',
      colors: '',
      auto: false,
    });
    expect(result.needsPhoto).toEqual([{ name: 'Matthew Hightower', role: 'Defendant' }]);
    expect(service.openaiService.generateThumbnailImage).not.toHaveBeenCalled();
  });

  it('sends the verified photos as references when every required face has one', async () => {
    const service = chatService([
      { name: 'Latrina Ashburne', role: 'Victim', imageUrl: 'https://p/a.jpg', photoStatus: 'verified' },
    ]);
    service.openaiService.generateThumbnailImage.mockResolvedValue({
      imageUrl: 'https://img/final.png',
      cleanBackgroundUrl: 'https://img/clean.png',
      revisedPrompt: '',
    });
    service.threadModel.updateOne = jest.fn();
    await service.generateThumbnailImage('t', {
      text: 'THEY KILLED THE WRONG WOMAN',
      visual: 'Portrait of Latrina Ashburne',
      colors: '',
    });
    expect(
      service.openaiService.generateThumbnailImage.mock.calls[0][0].referenceImageUrls,
    ).toEqual(['https://p/a.jpg']);
  });

  it('fixes a misspelled or covered headline with exactly one edit', async () => {
    const service = chatService([]);
    service.openaiService.generateThumbnailImage.mockResolvedValue({
      imageUrl: 'https://img/final.png',
      cleanBackgroundUrl: 'https://img/clean.png',
      revisedPrompt: '',
    });
    service.openaiService.reviewThumbnailText
      .mockResolvedValueOnce({ ok: false, issues: ['Headline overlaps the logo or host photo'] })
      .mockResolvedValueOnce({ ok: true, issues: [] });
    service.openaiService.editImageWithReference = jest.fn().mockResolvedValue({
      imageUrl: 'https://img/fixed.png',
      cleanBackgroundUrl: 'https://img/fixed-clean.png',
      revisedPrompt: '',
    });
    service.threadModel.updateOne = jest.fn();
    const result = await service.generateThumbnailImage('t', {
      text: 'HOW DO YOU SAY YOU’RE NOT COMING HOME?',
      visual: 'A man on a prison phone',
      colors: '',
    });
    expect(service.openaiService.editImageWithReference).toHaveBeenCalledTimes(1);
    const [base, prompt] = service.openaiService.editImageWithReference.mock.calls[0];
    expect(base).toBe('https://img/clean.png');
    expect(prompt).toContain('RESERVED CORNER');
    expect(result.image.url).toBe('https://img/fixed.png');
    expect(result.image.reviewIssues).toEqual([]);
  });

  it('retries a failed reference generation once and never falls back to invented faces', async () => {
    const ai = new OpenAIService(
      { get: (key: string, fallback: unknown) => (key === 'OPENAI_API_KEY' ? 'test-key' : fallback) } as never,
      {} as never,
      {} as never,
    );
    const generate = jest.fn();
    const edit = jest.fn().mockRejectedValue(new Error('provider down'));
    Object.assign(ai, { client: { images: { generate } }, editImageWithReference: edit });
    await expect(
      ai.generateThumbnailImage({
        concept: { text: 'THEY KILLED THE WRONG WOMAN', description: 'Portrait', colors: '' },
        videoTitle: 'x',
        referenceImageUrls: ['https://p/a.jpg'],
      }),
    ).rejects.toThrow('Could not generate the thumbnail from the real photos');
    expect(edit).toHaveBeenCalledTimes(2);
    expect(generate).not.toHaveBeenCalled();
  });
});

import { ChatService } from './chat.service';

describe('thumbnail aspect ratio', () => {
  const service: any = Object.create(ChatService.prototype);
  const ratio = (text: string) => service.parseClientThumbnailDirectives(text).aspectRatio;

  it('reads real format requests from the client', () => {
    expect(ratio('make it a reel thumbnail')).toBe('9:16');
    expect(ratio('I want it vertical')).toBe('9:16');
    expect(ratio('make this for Shorts')).toBe('9:16');
    expect(ratio('give me a shorts thumbnail')).toBe('9:16');
    expect(ratio('9:16 please')).toBe('9:16');
    expect(ratio('keep it landscape')).toBe('16:9');
  });

  it('does not treat the word "short" as a format request', () => {
    expect(ratio('find me an old short YouTube video from local news')).toBeUndefined();
    expect(ratio('make the headline shorter')).toBeUndefined();
    expect(ratio('a short clip of him walking')).toBeUndefined();
  });

  function generateHost(lastUser: string) {
    const host: any = Object.create(ChatService.prototype);
    host.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    host.threadModel = {
      findById: jest.fn().mockResolvedValue({
        _id: 't',
        channelId: 'c',
        title: 'T',
        messages: [{ role: 'user', content: lastUser }],
      }),
      updateOne: jest.fn().mockResolvedValue({}),
    };
    host.videoModel = { findById: jest.fn() };
    host.creatorPreferencesModel = { findOne: () => ({ select: () => ({ lean: async () => null }) }) };
    host.subjectReferenceService = { resolveSubjects: jest.fn().mockResolvedValue([]) };
    host.openaiService = {
      generateThumbnailImage: jest.fn().mockResolvedValue({ imageUrl: 'https://i/1.png', revisedPrompt: 'p' }),
      extractStoryContextFromThread: jest.fn().mockResolvedValue(''),
      reviewThumbnailText: jest.fn().mockResolvedValue({ ok: true, issues: [] }),
    };
    return host;
  }
  const dto = { text: 'HE KNEW', visual: 'v', colors: '' };

  it('lets the client chat words decide when the card sent no ratio', async () => {
    const host = generateHost('please make a reel thumbnail for this');
    await host.generateThumbnailImage('t', dto);
    expect(host.openaiService.generateThumbnailImage.mock.calls[0][0].aspectRatio).toBe('9:16');
  });

  it('defaults to 16:9 and respects an explicit choice from the card', async () => {
    const plain = generateHost('write the thumbnails');
    await plain.generateThumbnailImage('t', dto);
    expect(plain.openaiService.generateThumbnailImage.mock.calls[0][0].aspectRatio).toBe('16:9');

    const explicit = generateHost('please make a reel thumbnail');
    await explicit.generateThumbnailImage('t', { ...dto, aspectRatio: '16:9' });
    expect(explicit.openaiService.generateThumbnailImage.mock.calls[0][0].aspectRatio).toBe('16:9');
  });
});

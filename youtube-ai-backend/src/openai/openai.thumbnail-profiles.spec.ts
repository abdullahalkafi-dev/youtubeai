import { OpenAIService } from './openai.service';

/**
 * Guards the Safe thumbnail path: its prompt and the edit rules that follow it must never change
 * as the Bold thumbnail evolves. The snapshots were recorded before the Bold v2 work.
 */
describe('thumbnail prompt profiles', () => {
  function setup(env: Record<string, string> = {}) {
    const ai: any = new OpenAIService(
      {
        get: (key: string, fallback: unknown) =>
          key === 'OPENAI_API_KEY' ? 'test-key' : (env[key] ?? fallback),
      } as never,
      {} as never,
      {} as never,
    );
    const edit = jest.fn().mockResolvedValue({
      data: [{ b64_json: Buffer.from('image').toString('base64') }],
    });
    ai.client = { images: { edit } };
    ai.minioService = {
      getFileBuffer: jest.fn().mockResolvedValue(Buffer.from('photo')),
      isAvailable: jest.fn().mockResolvedValue(true),
      uploadThumbnail: jest.fn().mockResolvedValue('https://clean/bg.png'),
    };
    ai.composerService = {
      composeThumbnail: jest.fn().mockResolvedValue(Buffer.from('composed')),
      fetchBufferFromUrl: jest.fn().mockResolvedValue(Buffer.from('x')),
    };
    ai.uploadFinal = undefined;
    return { ai, edit };
  }

  const concept = {
    text: 'FAME CAN’T OPEN THAT DOOR',
    description: 'Diddy large on the right, serious guarded expression, dark doorway silhouette',
    colors: 'Deep navy, white lettering',
  };
  const base = {
    concept,
    videoTitle: 'Diddy moved to a new prison',
    selectedHostImage: 'default',
    logoPosition: 'top-right' as const,
    aspectRatio: '16:9' as const,
    storyContext: '',
    referenceImageUrls: ['https://meccaaudio.com/api/assets/minio/system/subjects/diddy.jpg'],
  };

  it('Safe: the prompt sent for a real person is unchanged', async () => {
    const { ai } = setup();
    const spy = jest.spyOn(ai, 'editImageWithReference').mockResolvedValue({ imageUrl: 'u', revisedPrompt: 'p' });
    await ai.generateThumbnailImage({ ...base, variant: 'safe' });
    expect(spy.mock.calls[0][1]).toMatchSnapshot();
  });

  it('standard edit rules (headline fix, image edit, Safe) are unchanged', async () => {
    const { ai, edit } = setup();
    await ai.editImageWithReference(
      'https://meccaaudio.com/api/assets/minio/system/subjects/diddy.jpg',
      'Fix ONLY the headline lettering.',
      { mode: 'thumbnail', aspectRatio: '16:9', referenceImageUrls: ['https://meccaaudio.com/api/assets/minio/system/subjects/b.jpg'] },
    );
    expect(edit.mock.calls[0][0].prompt).toMatchSnapshot();
  });
});

import { OpenAIService } from './openai.service';

/**
 * OpenAI's safety filter refuses a few well-known figures. The normal thumbnail path must stay exactly
 * as it was; only after it fails on a safety rejection does the fallback (text-free picture + headline
 * drawn locally) run.
 */
describe('thumbnail safety fallback', () => {
  const safetyError = () =>
    Object.assign(
      new Error('400 Your request was rejected by the safety system. safety_violations=[violence].'),
      { status: 400 },
    );

  function setup(env: Record<string, string> = {}) {
    const ai: any = new OpenAIService(
      {
        get: (key: string, fallback: unknown) =>
          key === 'OPENAI_API_KEY' ? 'test-key' : (env[key] ?? fallback),
      } as never,
      {} as never,
      {} as never,
    );
    const edit = jest.fn();
    const generate = jest.fn();
    ai.client = { images: { edit, generate } };
    ai.minioService = {
      getFileBuffer: jest.fn().mockResolvedValue(Buffer.from('photo')),
      isAvailable: jest.fn().mockResolvedValue(true),
      uploadThumbnail: jest.fn().mockImplementation(async (_b: string, name: string) => `https://minio/${name}`),
    };
    ai.composerService = {
      composeThumbnail: jest.fn().mockResolvedValue(Buffer.from('composed')),
      composeStudioThumbnail: jest.fn().mockResolvedValue({ buffer: Buffer.from('studio'), issues: [] }),
      fetchBufferFromUrl: jest.fn().mockResolvedValue(Buffer.from('x')),
    };
    const editWithReference = jest.spyOn(ai, 'editImageWithReference');
    return { ai, edit, generate, editWithReference };
  }

  const image = { data: [{ b64_json: Buffer.from('image').toString('base64') }] };
  const params = {
    concept: {
      text: 'TUPAC SHAKUR / KILLED AT JUST 25 / WHO WOULD HE BE TODAY?',
      description: 'Tupac Shakur close-up, serious face, dark background',
      colors: 'charcoal, white, yellow',
    },
    videoTitle: 'Tupac live',
    selectedHostImage: 'host_3.png',
    logoPosition: 'top-right' as const,
    aspectRatio: '16:9' as const,
    storyContext: 'Tupac Shakur, a rapper',
    referenceImageUrls: ['https://meccaaudio.com/api/assets/minio/system/subjects/subj_tupac.jpg'],
    variant: 'bold' as const,
  };

  it('normal success: no fallback call, result unchanged', async () => {
    const { ai, edit, generate, editWithReference } = setup();
    editWithReference.mockResolvedValue({ imageUrl: 'u', revisedPrompt: 'p' });
    const result = await ai.generateThumbnailImage(params);
    expect(result).toEqual({ imageUrl: 'u', revisedPrompt: 'p' });
    expect(result.safetyFallback).toBeUndefined();
    expect(editWithReference).toHaveBeenCalledTimes(1);
    expect(edit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('a non-safety error keeps the old behavior: 2 attempts, old message, no fallback', async () => {
    const { ai, edit, generate, editWithReference } = setup();
    editWithReference.mockRejectedValue(new Error('Image API issue: network down'));
    await expect(ai.generateThumbnailImage(params)).rejects.toThrow(
      /Could not generate the thumbnail from the real photos \(Image API issue: network down\)\. Try again or upload a different photo\./,
    );
    expect(editWithReference).toHaveBeenCalledTimes(2);
    expect(edit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('safety rejection: the existing 2 attempts still run first, then the text-free photo fallback', async () => {
    const { ai, edit, generate, editWithReference } = setup();
    editWithReference.mockRejectedValue(new Error('Image API issue: image edit failed on all models. ' + safetyError().message));
    edit.mockResolvedValue(image);
    const result = await ai.generateThumbnailImage(params);

    expect(editWithReference).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
    expect(result.safetyFallback).toBe('photo');
    expect(result.imageUrl).toMatch(/edited_/);

    // OpenAI never sees the name or the headline words.
    const sent = edit.mock.calls[0][0];
    expect(sent.prompt).toContain('No text anywhere in the image');
    expect(sent.prompt).not.toMatch(/tupac|shakur|killed/i);
    expect(sent.size).toBe('1536x864');

    // The exact headline is drawn locally, with the same host and logo choices as the normal path.
    const composed = ai.composerService.composeStudioThumbnail.mock.calls[0][0];
    expect(composed.text).toBe(params.concept.text);
    expect(composed.textSide).toBe('left');
    expect(composed.selectedHostImage).toBe('host_3.png');
    expect(composed.logoPosition).toBe('top-right');
    expect(composed.excludeHost).toBe(false);
  });

  it('photo refused 3 times: falls to the symbolic scene, still with the exact headline', async () => {
    const { ai, edit, generate, editWithReference } = setup();
    editWithReference.mockRejectedValue(safetyError());
    edit.mockRejectedValue(safetyError());
    generate.mockResolvedValue(image);
    const result = await ai.generateThumbnailImage(params);

    expect(edit).toHaveBeenCalledTimes(3);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(result.safetyFallback).toBe('symbolic');
    expect(generate.mock.calls[0][0].prompt).not.toMatch(/tupac|shakur|killed/i);
    expect(generate.mock.calls[0][0].prompt).toContain('empty wooden chair');
    expect(ai.composerService.composeStudioThumbnail.mock.calls[0][0].text).toBe(params.concept.text);
  });

  it('everything refused: a clear message, bounded calls', async () => {
    const { ai, edit, generate, editWithReference } = setup();
    editWithReference.mockRejectedValue(safetyError());
    edit.mockRejectedValue(safetyError());
    generate.mockRejectedValue(safetyError());
    await expect(ai.generateThumbnailImage(params)).rejects.toThrow(/safety filter refused to draw this person/);
    expect(edit).toHaveBeenCalledTimes(3);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it('a non-safety error inside the fallback stops that step instead of looping', async () => {
    const { ai, edit, generate, editWithReference } = setup();
    editWithReference.mockRejectedValue(safetyError());
    edit.mockRejectedValue(new Error('socket hang up'));
    generate.mockResolvedValue(image);
    const result = await ai.generateThumbnailImage(params);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(result.safetyFallback).toBe('symbolic');
  });

  it('THUMBNAIL_SAFETY_FALLBACK=off restores the old behavior exactly', async () => {
    const { ai, edit, generate, editWithReference } = setup({ THUMBNAIL_SAFETY_FALLBACK: 'off' });
    editWithReference.mockRejectedValue(safetyError());
    await expect(ai.generateThumbnailImage(params)).rejects.toThrow(
      /Could not generate the thumbnail from the real photos .*Try again or upload a different photo\./s,
    );
    expect(editWithReference).toHaveBeenCalledTimes(2);
    expect(edit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('vertical thumbnails use the vertical size and the Shorts wording', async () => {
    const { ai, edit, editWithReference } = setup();
    editWithReference.mockRejectedValue(safetyError());
    edit.mockResolvedValue(image);
    await ai.generateThumbnailImage({ ...params, aspectRatio: '9:16' });
    expect(edit.mock.calls[0][0].size).toBe('864x1536');
    expect(edit.mock.calls[0][0].prompt).toContain('9:16 vertical YouTube Shorts');
    expect(ai.composerService.composeStudioThumbnail.mock.calls[0][0].aspectRatio).toBe('9:16');
  });

  it('respects "no host" and "no logo" choices', async () => {
    const { ai, edit, editWithReference } = setup();
    editWithReference.mockRejectedValue(safetyError());
    edit.mockResolvedValue(image);
    await ai.generateThumbnailImage({ ...params, excludeHost: true, excludeLogo: true, logoPosition: 'none' });
    const composed = ai.composerService.composeStudioThumbnail.mock.calls[0][0];
    expect(composed.excludeHost).toBe(true);
    expect(composed.selectedHostImage).toBe('none');
    expect(composed.excludeLogo).toBe(true);
    expect(composed.logoPosition).toBe('none');
  });
});

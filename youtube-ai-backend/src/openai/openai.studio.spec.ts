import { OpenAIService } from './openai.service';
describe('studio image provider request policy', () => {
  const params = () => ({
    visual: 'A family phone call',
    referenceImageUrls: [] as string[],
    aspectRatio: '16:9' as const,
    textSide: 'left' as const,
    onRequest: jest.fn(),
  });
  function setup() {
    const ai = new OpenAIService(
      {
        get: (key: string, fallback: unknown) =>
          key === 'OPENAI_API_KEY' ? 'test-key' : fallback,
      } as never,
      {} as never,
      {} as never,
    );
    const generate = jest
      .fn()
      .mockResolvedValue({
        data: [{ b64_json: Buffer.from('image').toString('base64') }],
        _request_id: 'provider-id',
      });
    Object.assign(ai, { client: { images: { generate } } });
    return { ai, generate };
  }
  it('makes one request with SDK retries disabled and preserves provider provenance', async () => {
    const { ai, generate } = setup(),
      input = params();
    const result = await ai.generateStudioScene(input);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
    expect(result.requestId).toBe('provider-id');
    expect(input.onRequest).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].prompt).toContain('No headline');
  });
  it('never silently retries an uncertain timeout', async () => {
    const { ai, generate } = setup();
    generate.mockRejectedValue(
      Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' }),
    );
    await expect(ai.generateStudioScene(params())).rejects.toThrow('Timeout');
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('does not try another model after a definitive rejection', async () => {
    const { ai, generate } = setup();
    generate.mockRejectedValue(
      Object.assign(new Error('Rejected'), { status: 400 }),
    );
    await expect(ai.generateStudioScene(params())).rejects.toThrow('Rejected');
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('allows at most two safe rate-limit retries', async () => {
    jest.useFakeTimers();
    const { ai, generate } = setup();
    generate
      .mockRejectedValueOnce(
        Object.assign(new Error('Rate limit'), { status: 429 }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error('Rate limit'), { status: 429 }),
      );
    const work = ai.generateStudioScene(params());
    await jest.runAllTimersAsync();
    await expect(work).resolves.toHaveProperty('requestId', 'provider-id');
    expect(generate).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });
  describe('edit mode and client-requested details', () => {
    const png = () =>
      require('sharp')({
        create: { width: 64, height: 36, channels: 3, background: 'gray' },
      })
        .png()
        .toBuffer();
    it('edits the stored scene first and lists the requested details', async () => {
      const { ai } = setup();
      const edit = jest.fn().mockResolvedValue({
        data: [{ b64_json: Buffer.from('image').toString('base64') }],
      });
      const buffer = await png();
      Object.assign(ai, {
        client: { images: { edit, generate: jest.fn() } },
        composerService: { fetchBufferFromUrl: jest.fn().mockResolvedValue(buffer) },
      });
      await ai.generateStudioScene({
        ...params(),
        referenceImageUrls: ['https://example.test/face.png'],
        baseImageUrl: 'https://example.test/clean.png',
        editInstruction: 'add a head bandage and tears',
        clientRequestedDetails: ['head bandage'],
      });
      const [request] = edit.mock.calls[0];
      expect(request.image).toHaveLength(2);
      expect(request.prompt).toContain('Edit the FIRST image');
      expect(request.prompt).toContain('add a head bandage and tears');
      expect(request.prompt).toContain('head bandage');
      expect(request.prompt).not.toContain('Do not invent injuries');
    });
    it('keeps a no-extras rule when the client requested nothing special', async () => {
      const { ai, generate } = setup();
      await ai.generateStudioScene(params());
      expect(generate.mock.calls[0][0].prompt).toContain('Add no injuries');
    });
  });
});

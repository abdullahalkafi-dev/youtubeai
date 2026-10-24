import { ChatService, shouldAutoGenerateImages } from './chat.service';

describe('shouldAutoGenerateImages', () => {
  it('fires for a confident thumbnail or package routing', () => {
    expect(shouldAutoGenerateImages('thumbnail', 0.95, 'do the second one')).toBe(true);
    expect(shouldAutoGenerateImages('package', 0.8, 'do the second one')).toBe(true);
  });

  it('stays off for a low-confidence follow-up with no thumbnail words', () => {
    expect(shouldAutoGenerateImages('thumbnail', 0.6, 'make it darker')).toBe(false);
    expect(shouldAutoGenerateImages('general', 0.99, 'how is my channel doing')).toBe(false);
  });

  it('fires when the client asks for thumbnails in their own words, whatever the routing', () => {
    expect(shouldAutoGenerateImages('general', 0.5, 'here is the picture, generate me a thumbnail')).toBe(true);
  });
});

describe('a photo sent with a thumbnail ask (upload path)', () => {
  const thumbnailReply =
    'Plan.\n<!-- THUMBNAILS_START -->\n### Concept 1: A\n**Text overlay:** GOTTI JR. TOOK A PLEA\n<!-- THUMBNAILS_END -->';

  function uploadService(intent: { intent: string; confidence: number }, reply: string) {
    const service: any = Object.create(ChatService.prototype);
    service.logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    const thread = { _id: 't', channelId: 'c', messages: [] as any[] };
    service.threadModel = {
      findById: jest.fn().mockResolvedValue(thread),
      findByIdAndUpdate: jest.fn().mockResolvedValue({}),
    };
    service.channelModel = { findById: () => ({ lean: async () => ({}) }) };
    service.minioService = { uploadBuffer: jest.fn().mockResolvedValue('https://m/u.png') };
    service.intentClassifier = { classify: jest.fn().mockResolvedValue({ ...intent, source: 'llm' }) };
    service.skillRegistry = {
      get: () => ({
        loadContext: async () => ({}),
        buildSystemPrompt: () => 'sys',
        getTemperature: () => 0.7,
      }),
      applyRequestDrivenContext: jest.fn(),
      buildDynamicContext: () => '',
    };
    service.openaiService = { chatWithVision: jest.fn().mockResolvedValue({ content: reply, usage: {} }) };
    service.chromaService = { upsert: jest.fn() };
    service.handleFirstMessage = jest.fn();
    service.checkThreadHealth = jest.fn().mockResolvedValue({ ok: true });
    service.buildRagContext = jest.fn().mockResolvedValue('');
    service.logAiOutput = jest.fn();
    return service;
  }

  const file: any = { originalname: 'a b.png', mimetype: 'image/png', buffer: Buffer.from('x') };

  function savedAssistant(service: any) {
    const calls = service.threadModel.findByIdAndUpdate.mock.calls;
    const push = calls.map((c: any[]) => c[1]?.$push?.messages).filter((m: any) => m?.role === 'assistant');
    return push[0];
  }

  it('flags the reply for auto-generated images when the router is sure', async () => {
    const service = uploadService({ intent: 'thumbnail', confidence: 0.9 }, thumbnailReply);
    await service.handleFileUpload('t', file, 'make me a thumbnail with this photo');
    expect(savedAssistant(service).metadata).toEqual({ category: 'thumbnail', autoImages: true });
  });

  it('still flags it when the router failed (0.5) but the client said "thumbnail"', async () => {
    const service = uploadService({ intent: 'thumbnail', confidence: 0.5 }, thumbnailReply);
    await service.handleFileUpload('t', file, 'generate me a thumbnail and here is the photo');
    expect(savedAssistant(service).metadata.autoImages).toBe(true);
  });

  it('does not flag a reply that has no thumbnail concepts', async () => {
    const service = uploadService({ intent: 'thumbnail', confidence: 0.95 }, 'Please upload the second photo too.');
    await service.handleFileUpload('t', file, 'make me a thumbnail');
    expect(savedAssistant(service).metadata.autoImages).toBeUndefined();
  });

  it('a plain photo with a general question never flags images', async () => {
    const service = uploadService({ intent: 'general', confidence: 0.9 }, thumbnailReply);
    await service.handleFileUpload('t', file, 'who is this person?');
    expect(savedAssistant(service).metadata.autoImages).toBeUndefined();
  });
});

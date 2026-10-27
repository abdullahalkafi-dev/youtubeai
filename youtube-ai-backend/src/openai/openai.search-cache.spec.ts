import { OpenAIService } from './openai.service';

describe('web-search chat keeps the prompt cacheable and reports real cache usage', () => {
  function setup(response: any) {
    const ai: any = new OpenAIService(
      { get: (key: string, fallback: unknown) => (key === 'OPENAI_API_KEY' ? 'test-key' : fallback) } as never,
      {} as never,
      {} as never,
    );
    const create = jest.fn().mockResolvedValue(response);
    ai.client = { responses: { create } };
    return { ai, create };
  }

  const completed = {
    output_text: 'the answer',
    output: [],
    usage: { input_tokens: 40000, output_tokens: 900, input_tokens_details: { cached_tokens: 36864 } },
  };

  it('puts the per-request context in the last user message, not the system prompt', async () => {
    const { ai, create } = setup(completed);
    await ai.chatWithSearch({
      systemPrompt: 'STATIC SYSTEM',
      dynamicContext: 'CHANGING CONTEXT',
      userMessage: 'write the script',
      conversationHistory: [{ role: 'user', content: 'earlier' }],
    });
    const input = create.mock.calls[0][0].input;
    expect(input[0].content[0].text).toBe('STATIC SYSTEM');
    const last = input[input.length - 1];
    expect(last.role).toBe('user');
    expect(last.content[0].text).toBe('CHANGING CONTEXT\n\nwrite the script');
    expect(JSON.stringify(input.slice(0, -1))).not.toContain('CHANGING CONTEXT');
  });

  it('sends the user message untouched when there is no per-request context', async () => {
    const { ai, create } = setup(completed);
    await ai.chatWithSearch({ systemPrompt: 'S', userMessage: 'just this' });
    const input = create.mock.calls[0][0].input;
    expect(input[input.length - 1].content[0].text).toBe('just this');
  });

  it('reads cached tokens from the Responses API usage instead of reporting a hardcoded zero', async () => {
    const { ai } = setup(completed);
    const out = await ai.chatWithSearch({ systemPrompt: 'S', userMessage: 'u' });
    expect(out.usage.promptTokens).toBe(40000);
    expect(out.usage.cachedTokens).toBe(36864);
    expect(out.usage.cacheHitRate).toBe(92);
  });

  it('streams with the same placement and the same real usage', async () => {
    const events = [
      { type: 'response.output_text.delta', delta: 'hel' },
      { type: 'response.output_text.delta', delta: 'lo' },
      { type: 'response.completed', response: completed },
    ];
    const { ai, create } = setup((async function* () {
      for (const e of events) yield e;
    })());
    let text = '';
    let usage: any;
    for await (const piece of ai.chatWithSearchStream({
      systemPrompt: 'STATIC SYSTEM',
      dynamicContext: 'CHANGING CONTEXT',
      userMessage: 'write the script',
    })) {
      text += piece.chunk;
      if (piece.usage) usage = piece.usage;
    }
    const input = create.mock.calls[0][0].input;
    expect(text).toBe('hello');
    expect(input[0].content[0].text).toBe('STATIC SYSTEM');
    expect(input[input.length - 1].content[0].text).toBe('CHANGING CONTEXT\n\nwrite the script');
    expect(usage.cachedTokens).toBe(36864);
  });

  it('reports zero (not NaN) when usage is missing', async () => {
    const { ai } = setup({ output_text: 'x', output: [] });
    const out = await ai.chatWithSearch({ systemPrompt: 'S', userMessage: 'u' });
    expect(out.usage).toEqual({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, cacheHitRate: 0 });
  });
});

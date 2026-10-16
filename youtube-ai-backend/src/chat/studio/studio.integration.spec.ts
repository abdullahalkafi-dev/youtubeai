import { Connection, createConnection, Model, Schema, Types } from 'mongoose';
import { spawn, ChildProcess } from 'child_process';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer } from 'net';
import { StudioService } from './studio.service';
import { STUDIO_MODELS } from './studio.schemas';
import { ThreadSchema } from '../../mongo/schemas/thread.schema';
import {
  PLAN_PROMPT,
  SCRIPT_PROMPT,
  PACKAGE_PROMPT,
  REVIEW_PROMPT,
} from './studio.prompts';

const binary =
  process.env.MONGOD_PATH ||
  (process.platform === 'win32'
    ? 'C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe'
    : '/usr/bin/mongod');
const suite =
  process.env.STUDIO_TEST_MONGO_URI || existsSync(binary)
    ? describe
    : describe.skip;
suite('durable studio execution with isolated MongoDB', () => {
  let connection: Connection;
  let processHandle: ChildProcess | undefined;
  let directory: string | undefined;
  let models: Record<string, Model<any>>;
  let service: StudioService;
  let threadId: string;
  let channelId: string;
  let stageQueue: any, imageQueue: any, ai: any, composer: any;
  let imageReview: 'pass' | 'repair' = 'pass';
  let planOverrides: any = {};
  const concept = {
    text: "HOW DO I TELL MY FAMILY\nI'M NEVER COMING HOME?",
    visual: 'Recognizable man holding a telephone, restrained tears',
    emotion: 'Wet eyes and tightened mouth',
    colors: 'white yellow blue',
    textSide: 'left',
    aspectRatio: '16:9',
    excludeHost: true,
    excludeLogo: true,
  };
  const script = {
    title: 'The family call',
    sections: [
      {
        title: 'The difficult call',
        purpose: 'Explain prison separation',
        blocks: [{ lines: [Array(130).fill('family').join(' ')] }],
      },
    ],
  };
  const requestPlan = (request: string) => ({
    action: request.includes('question') ? 'answer' : 'create',
    topic: 'Keefe D family call',
    subjects: ['Keefe D'],
    promise: 'The family conversation',
    emphasis: 'family',
    mode: 'new',
    deliverables: request.includes('question')
      ? ['answer']
      : ['script', 'packaging'],
    thumbnails: !request.includes('question'),
    research: false,
    newEpisode: true,
    duration: { min: 8, max: 10 },
    questions: [],
    standingPreferences: [],
    ...planOverrides,
  });
  const submit = (
    id = 'request-a',
    content = 'Write a 1-minute script, title and thumbnails',
  ) => service.submit(threadId, { content, clientRequestId: id });

  beforeAll(async () => {
    let uri = process.env.STUDIO_TEST_MONGO_URI;
    if (!uri) {
      directory = mkdtempSync(join(tmpdir(), 'studio-integration-'));
      const port = await new Promise<number>((resolve) => {
        const server = createServer();
        server.listen(0, '127.0.0.1', () => {
          const address = server.address() as { port: number };
          server.close(() => resolve(address.port));
        });
      });
      processHandle = spawn(
        binary,
        [
          '--dbpath',
          directory,
          '--port',
          String(port),
          '--bind_ip',
          '127.0.0.1',
          '--quiet',
        ],
        { windowsHide: true, stdio: 'ignore' },
      );
      processHandle.on('error', () => undefined);
      uri = 'mongodb://127.0.0.1:' + port;
    }
    connection = await createConnection(uri, {
      dbName: 'studio_test_' + new Types.ObjectId(),
      serverSelectionTimeoutMS: 20000,
    }).asPromise();
    models = {};
    for (const model of STUDIO_MODELS)
      models[model.name] = connection.model(model.name, model.schema.clone());
    models.Thread = connection.model('Thread', ThreadSchema.clone());
    for (const name of ['Channel', 'Video', 'AIOutputLog'])
      models[name] = connection.model(name, new Schema({}, { strict: false }));
    await Promise.all(Object.values(models).map((model) => model.init()));
  }, 30000);
  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
    if (processHandle) {
      processHandle.kill();
      await new Promise((resolve) => processHandle!.once('exit', resolve));
    }
    if (
      directory &&
      directory.startsWith(join(tmpdir(), 'studio-integration-'))
    )
      rmSync(directory, { recursive: true, force: true });
  }, 30000);
  beforeEach(async () => {
    for (const model of Object.values(models)) await model.deleteMany({});
    channelId = String(new Types.ObjectId());
    threadId = String(new Types.ObjectId());
    await models.Channel.create({
      _id: new Types.ObjectId(channelId),
      name: 'Unique Mecca Audio',
    });
    await models.Thread.create({
      _id: new Types.ObjectId(threadId),
      channelId: new Types.ObjectId(channelId),
      type: 'standalone',
      title: 'Old Diddy video',
      messages: [],
    });
    stageQueue = {
      add: jest.fn().mockResolvedValue({}),
      getJob: jest.fn().mockResolvedValue(null),
    };
    imageQueue = {
      add: jest.fn().mockResolvedValue({}),
      getJob: jest.fn().mockResolvedValue(null),
    };
    imageReview = 'pass';
    planOverrides = {};
    ai = {
      chat: jest.fn(async (params: any) => {
        const input = JSON.parse(params.messages[0].content);
        const system = params.systemPromptOverride;
        let output: any;
        if (system === PLAN_PROMPT) output = requestPlan(input.request);
        else if (system === SCRIPT_PROMPT) output = script;
        else if (system === PACKAGE_PROMPT)
          output = {
            title: 'The hardest family call in prison',
            rationale: 'An editorial hypothesis',
            thumbnails: [concept, { ...concept, textSide: 'right' }],
          };
        else if (system === REVIEW_PROMPT)
          output = {
            status: input.concept ? imageReview : 'pass',
            issues:
              input.concept && imageReview === 'repair'
                ? ['Expression needs stronger visible tears']
                : [],
            instruction: 'Strengthen eyes and mouth without changing identity',
          };
        else
          output = {
            sections: [
              { title: 'The call', purpose: 'Family separation', seconds: 60 },
            ],
            promise: 'The family conversation',
          };
        return {
          content: typeof output === 'string' ? output : JSON.stringify(output),
          usage: { promptTokens: 10, completionTokens: 20 },
        };
      }),
      generateStudioScene: jest.fn(async (params: any) => {
        await params.onRequest?.();
        return { buffer: Buffer.from('scene'), requestId: 'provider-1' };
      }),
      chatWithSearch: jest.fn().mockResolvedValue({ content: '', sources: [] }),
    };
    const sharp = require('sharp');
    const validImage = await sharp({
      create: { width: 1536, height: 864, channels: 3, background: 'blue' },
    })
      .png()
      .toBuffer();
    composer = {
      composeStudioThumbnail: jest
        .fn()
        .mockResolvedValue({ buffer: validImage, issues: [] }),
      fetchBufferFromUrl: jest.fn().mockResolvedValue(validImage),
    };
    service = new StudioService(
      models.ContentRun,
      models.ContentArtifact,
      models.EpisodeBrief,
      models.CreatorPreferences,
      models.ContentRunEvent,
      models.Thread,
      models.Channel,
      models.Video,
      models.AIOutputLog,
      stageQueue,
      imageQueue,
      ai,
      {
        detectAndFetchSubjects: jest
          .fn()
          .mockResolvedValue([
            { name: 'Keefe D', imageUrl: 'https://example.test/reference.png' },
          ]),
      } as any,
      composer,
      {
        uploadBuffer: jest.fn(
          async (key: string) => 'https://example.test/' + key,
        ),
      } as any,
      { query: jest.fn().mockResolvedValue([]) } as any,
      {
        get: () => ({ loadContext: jest.fn().mockResolvedValue({}) }),
        buildDynamicContext: () => '',
      } as any,
      { get: (_key: string, defaultValue: any) => defaultValue } as any,
    );
  });
  it('deduplicates concurrent submissions and persists one user/assistant pair', async () => {
    const [a, b] = await Promise.all([submit(), submit()]);
    expect(a.runId).toBe(b.runId);
    expect(await models.ContentRun.countDocuments()).toBe(1);
    const thread = await models.Thread.findById(threadId);
    expect(thread.messages).toHaveLength(2);
  });
  it('queues two images before script writing and keeps the current subject', async () => {
    const request = await submit();
    const original = ai.chat.getMockImplementation();
    ai.chat.mockImplementation(async (params: any) => {
      if (params.systemPromptOverride === SCRIPT_PROMPT)
        expect(imageQueue.add).toHaveBeenCalledTimes(2);
      return original(params);
    });
    await service.execute(request.runId);
    const snapshot = await service.snapshot(threadId, request.runId);
    expect(snapshot.status).toBe('awaiting_images');
    expect(snapshot.plan.topic).toContain('Keefe D');
    expect(
      snapshot.artifacts.filter((a: any) => a.kind === 'thumbnail'),
    ).toHaveLength(2);
    await Promise.all(
      snapshot.artifacts
        .filter((a: any) => a.kind === 'thumbnail')
        .map((a: any) => service.executeImage(String(a._id))),
    );
    const done = await service.snapshot(threadId, request.runId);
    expect(done.status).toBe('completed');
    const thread = await models.Thread.findById(threadId);
    const message = thread.messages.find(
      (m: any) => String(m._id) === request.messageId,
    );
    expect(message.metadata.images).toHaveLength(2);
    expect(message.metadata.autoImages).toBe(false);
  });
  it('does not let concurrent workers claim the same run twice', async () => {
    const request = await submit();
    await Promise.all([
      service.execute(request.runId),
      service.execute(request.runId),
    ]);
    expect(imageQueue.add).toHaveBeenCalledTimes(2);
    expect(
      await models.ContentArtifact.countDocuments({ kind: 'script' }),
    ).toBe(1);
  });
  it('preserves a successful image when its sibling has an unknown provider outcome', async () => {
    const request = await submit();
    await service.execute(request.runId);
    const images: any[] = (
      await service.snapshot(threadId, request.runId)
    ).artifacts.filter((a: any) => a.kind === 'thumbnail');
    await service.executeImage(String(images[0]._id));
    ai.generateStudioScene.mockImplementationOnce(async (params: any) => {
      await params.onRequest?.();
      throw new Error('Provider timeout');
    });
    await service.executeImage(String(images[1]._id));
    const done = await service.snapshot(threadId, request.runId);
    expect(done.status).toBe('completed_with_issues');
    expect(
      done.artifacts.find((a: any) => String(a._id) === String(images[0]._id))
        .status,
    ).toBe('ready');
    expect(
      done.artifacts.find((a: any) => String(a._id) === String(images[1]._id))
        .status,
    ).toBe('unknown');
    await service.reconcile();
    expect(
      await models.ContentArtifact.countDocuments({ status: 'unknown' }),
    ).toBe(1);
  });
  it('caps visual corrections at one and exposes remaining review issues', async () => {
    imageReview = 'repair';
    const request = await submit();
    await service.execute(request.runId);
    const image: any = (
      await service.snapshot(threadId, request.runId)
    ).artifacts.find((a: any) => a.kind === 'thumbnail');
    await service.executeImage(String(image._id));
    const result = await models.ContentArtifact.findById(image._id);
    expect(ai.generateStudioScene).toHaveBeenCalledTimes(2);
    expect(result.corrections).toBe(1);
    expect(result.status).toBe('needs_attention');
  });
  it('cancellation prevents pending provider requests', async () => {
    const request = await submit();
    await service.execute(request.runId);
    const images: any[] = (
      await service.snapshot(threadId, request.runId)
    ).artifacts.filter((a: any) => a.kind === 'thumbnail');
    await service.cancel(threadId, request.runId);
    await Promise.all(images.map((a) => service.executeImage(String(a._id))));
    expect(ai.generateStudioScene).not.toHaveBeenCalled();
    expect((await service.snapshot(threadId, request.runId)).status).toBe(
      'cancelled',
    );
  });
  it('recovers an expired lease without restarting an uncertain paid generation', async () => {
    const request = await submit();
    await service.execute(request.runId);
    const images: any[] = (
      await service.snapshot(threadId, request.runId)
    ).artifacts.filter((a: any) => a.kind === 'thumbnail');
    await models.ContentArtifact.updateOne(
      { _id: images[0]._id },
      {
        $set: {
          status: 'running',
          owner: 'dead-worker',
          providerStarted: true,
          leaseUntil: new Date(0),
        },
      },
    );
    await service.reconcile();
    expect((await models.ContentArtifact.findById(images[0]._id)).status).toBe(
      'unknown',
    );
    expect(ai.generateStudioScene).not.toHaveBeenCalled();
  });
  it('scopes run/artifact lookups to their actual thread', async () => {
    const request = await submit();
    await service.execute(request.runId);
    const artifact: any = (await service.snapshot(threadId, request.runId))
      .artifacts[0];
    const other = String(new Types.ObjectId());
    await expect(service.snapshot(other, request.runId)).rejects.toThrow(
      'not found',
    );
    await expect(service.artifact(other, String(artifact._id))).rejects.toThrow(
      'not found',
    );
  });
  it('updates explicit preferences with revision protection', async () => {
    const initial = await service.getPreferences(channelId);
    const first = await service.updatePreferences(channelId, {
      revision: initial.revision,
      enabled: true,
      instructions: ['Use recognizable faces'],
    });
    expect(first.enabled).toBe(true);
    expect(first.instructions).toEqual(['Use recognizable faces']);
    const next = await service.updatePreferences(channelId, {
      revision: first.revision,
      instructions: [],
    });
    expect(next.instructions).toEqual([]);
    await expect(
      service.updatePreferences(channelId, {
        revision: first.revision,
        instructions: ['stale'],
      }),
    ).rejects.toThrow('changed');
  });
  it('returns monotonic events and does not expose events from another thread', async () => {
    const request = await submit();
    await service.execute(request.runId);
    const events: any[] = await service.eventList(threadId, request.runId, 0);
    expect(events.length).toBeGreaterThan(2);
    expect(events.map((e) => e.sequence)).toEqual(
      [...events.map((e) => e.sequence)].sort((a, b) => a - b),
    );
    expect(
      await service.eventList(
        threadId,
        request.runId,
        events[events.length - 1].sequence,
      ),
    ).toEqual([]);
    await expect(
      service.eventList(String(new Types.ObjectId()), request.runId, 0),
    ).rejects.toThrow();
  });
  it('does not replace the active episode when answering an ordinary question', async () => {
    const first = await submit();
    await service.execute(first.runId);
    const episode = await models.EpisodeBrief.findOne({ threadId });
    const next = await submit(
      'ordinary-question',
      'A question: what does CTR mean?',
    );
    await service.execute(next.runId);
    expect(await models.EpisodeBrief.countDocuments()).toBe(1);
    expect(String((await models.EpisodeBrief.findOne({ threadId }))._id)).toBe(
      String(episode._id),
    );
    expect(
      (await service.snapshot(threadId, next.runId)).artifacts.some(
        (a: any) => a.kind === 'thumbnail',
      ),
    ).toBe(false);
  });
  it('rejects malformed requests before persisting or enqueueing work', async () => {
    await expect(service.submit(threadId, { content: '' })).rejects.toThrow(
      '1-50000',
    );
    await expect(
      service.submit(threadId, {
        content: 'hello',
        clientRequestId: 'x'.repeat(101),
      }),
    ).rejects.toThrow('identifier');
    expect(await models.ContentRun.countDocuments()).toBe(0);
  });
  it('uses an explicit uploaded identity before a web reference', async () => {
    const request = await submit();
    await service.execute(request.runId);
    const uploaded = 'https://example.test/client-face.png';
    await models.ContentRun.updateOne(
      { _id: request.runId },
      {
        $set: {
          'request.attachments': [{ type: 'image', url: uploaded }],
          'plan.referenceRoles': [{ url: uploaded, role: 'identity' }],
        },
      },
    );
    const artifact: any = (
      await service.snapshot(threadId, request.runId)
    ).artifacts.find((a: any) => a.kind === 'thumbnail');
    await service.executeImage(String(artifact._id));
    expect(ai.generateStudioScene.mock.calls[0][0].referenceImageUrls).toEqual([
      uploaded,
    ]);
  });
  it('treats an unclassified upload as the subject face and flags an unusable photo', async () => {
    const request = await submit();
    await service.execute(request.runId);
    const uploaded = 'https://example.test/tiny-face.png';
    const sharp = require('sharp');
    const tiny = await sharp({
      create: { width: 120, height: 120, channels: 3, background: 'gray' },
    })
      .png()
      .toBuffer();
    const fetchBuffer = composer.fetchBufferFromUrl.getMockImplementation();
    composer.fetchBufferFromUrl.mockImplementation(async (url: string) =>
      url === uploaded ? tiny : fetchBuffer(url),
    );
    await models.ContentRun.updateOne(
      { _id: request.runId },
      { $set: { 'request.attachments': [{ type: 'image', url: uploaded }] } },
    );
    const artifact: any = (
      await service.snapshot(threadId, request.runId)
    ).artifacts.find((a: any) => a.kind === 'thumbnail');
    await service.executeImage(String(artifact._id));
    // Too small: not sent as identity; the web reference is used instead.
    expect(ai.generateStudioScene.mock.calls[0][0].referenceImageUrls).toEqual([
      'https://example.test/reference.png',
    ]);
    const result = await models.ContentArtifact.findById(artifact._id);
    expect(result.status).toBe('needs_attention');
    expect(result.review.issues.join(' ')).toContain('larger, clear photo');
  });
  it('uses channel-approved style references and face photos, never counterexamples', async () => {
    await service.updatePreferences(channelId, {
      visualReferenceAssets: [
        { url: '/api/assets/minio/references/strong.png', role: 'style', note: 'strong tears' },
        { url: '/api/assets/minio/references/weak.png', role: 'counterexample', note: 'vague wording' },
      ],
      identityReferences: [
        { name: 'Keefe D', url: '/api/assets/minio/references/keefe.png' },
      ],
    });
    const request = await submit();
    await service.execute(request.runId);
    const artifact: any = (
      await service.snapshot(threadId, request.runId)
    ).artifacts.find((a: any) => a.kind === 'thumbnail');
    await service.executeImage(String(artifact._id));
    const call = ai.generateStudioScene.mock.calls[0][0];
    expect(call.referenceImageUrls).toEqual(['/api/assets/minio/references/keefe.png']);
    expect(call.styleReferenceUrls).toEqual(['/api/assets/minio/references/strong.png']);
  });
  it('rejects malformed reference lists', async () => {
    await expect(
      service.updatePreferences(channelId, {
        visualReferenceAssets: [{ url: 'javascript:alert(1)', role: 'style' }],
      }),
    ).rejects.toThrow('Invalid visual reference list');
    await expect(
      service.updatePreferences(channelId, {
        identityReferences: [{ name: '', url: '/api/assets/minio/a.png' }],
      }),
    ).rejects.toThrow('Invalid identity reference list');
  });
  it('never turns an unattached model-supplied URL into an identity reference', async () => {
    const request = await submit();
    await service.execute(request.runId);
    await models.ContentRun.updateOne(
      { _id: request.runId },
      {
        $set: {
          'plan.referenceRoles': [
            { url: 'https://example.test/unattached.png', role: 'identity' },
          ],
        },
      },
    );
    const artifact: any = (
      await service.snapshot(threadId, request.runId)
    ).artifacts.find((a: any) => a.kind === 'thumbnail');
    await service.executeImage(String(artifact._id));
    expect(ai.generateStudioScene.mock.calls[0][0].referenceImageUrls).toEqual([
      'https://example.test/reference.png',
    ]);
  });
  const complete = async (runId: string) => {
    await service.execute(runId);
    const snapshot = await service.snapshot(threadId, runId);
    for (const image of snapshot.artifacts.filter(
      (a: any) => !a.outdated && a.status === 'pending',
    ))
      await service.executeImage(String(image._id));
    return service.snapshot(threadId, runId);
  };
  it('retains all deliverables when revising a selected script', async () => {
    const first = await submit();
    const original = await complete(first.runId);
    const target: any = original.artifacts.find(
      (a: any) => a.kind === 'script',
    );
    planOverrides = {
      action: 'revise',
      deliverables: ['script', 'packaging', 'outline'],
      thumbnails: true,
      newEpisode: false,
    };
    const revision = await service.revision(threadId, String(target._id), {
      content:
        'Revise the script and give me a title, outline and two thumbnails. Keep it 1 minute.',
      clientRequestId: 'mixed-edit',
    });
    const next = await complete(revision.runId);
    expect(
      next.artifacts
        .filter((a: any) => !a.outdated)
        .map((a: any) => a.kind)
        .sort(),
    ).toEqual(['outline', 'packaging', 'script', 'thumbnail', 'thumbnail']);
    const newPack: any = next.artifacts.find(
      (a: any) => a.kind === 'packaging',
    );
    const oldPack: any = original.artifacts.find(
      (a: any) => a.kind === 'packaging',
    );
    expect(String(newPack.sourceArtifactId)).toBe(String(oldPack._id));
    expect(String(newPack.sourceArtifactId)).not.toBe(String(target._id));
  });
  it('preserves images and title through successive description-only revisions', async () => {
    const first = await submit();
    const original = await complete(first.runId);
    const originalPack: any = original.artifacts.find(
      (a: any) => a.kind === 'packaging',
    );
    const originalImages = original.artifacts
      .filter((a: any) => a.kind === 'thumbnail')
      .map((a: any) => String(a._id))
      .sort();
    planOverrides = {
      action: 'revise',
      deliverables: ['packaging'],
      thumbnails: false,
      packagingChanges: ['description'],
      newEpisode: false,
    };
    const provider = ai.chat.getMockImplementation();
    ai.chat.mockImplementation(async (params: any) => {
      if (params.systemPromptOverride === PACKAGE_PROMPT)
        return {
          content: JSON.stringify({
            title: 'DO NOT REPLACE THE TITLE',
            description: 'New description',
            rationale: 'Description update',
            thumbnails: [],
          }),
        };
      return provider(params);
    });
    let target = originalPack;
    for (const requestId of ['metadata-one', 'metadata-two']) {
      const revision = await service.revision(threadId, String(target._id), {
        content: 'Change the description only',
        clientRequestId: requestId,
      });
      const next = await complete(revision.runId);
      target = next.artifacts.find((a: any) => a.kind === 'packaging');
      expect(target.data.title).toBe(originalPack.data.title);
      expect(target.data.description).toBe('New description');
      expect(
        next.artifacts
          .filter((a: any) => a.kind === 'thumbnail' && !a.outdated)
          .map((a: any) => String(a._id))
          .sort(),
      ).toEqual(originalImages);
      expect(next.status).toBe('completed');
    }
    expect(ai.generateStudioScene).toHaveBeenCalledTimes(2);
  });
  it('formats pasted speech without calling the script-writing model or using old speech', async () => {
    const first = await submit();
    await complete(first.runId);
    const callsBefore = ai.chat.mock.calls.filter(
      (call: any) => call[0].systemPromptOverride === SCRIPT_PROMPT,
    ).length;
    planOverrides = {
      action: 'format',
      deliverables: ['script'],
      thumbnails: false,
      newEpisode: false,
    };
    const next = await submit(
      'format-paste',
      'Make this breathable.\n\nScript:\nI called my mother. She waited twenty-six years for this conversation.',
    );
    const result = await complete(next.runId);
    const formatted: any = result.artifacts.find(
      (a: any) => a.kind === 'script',
    );
    expect(
      formatted.data.sections
        .flatMap((section: any) =>
          section.blocks.flatMap((block: any) => block.lines),
        )
        .join(' '),
    ).toBe(
      'I called my mother. She waited twenty-six years for this conversation.',
    );
    expect(
      ai.chat.mock.calls.filter(
        (call: any) => call[0].systemPromptOverride === SCRIPT_PROMPT,
      ),
    ).toHaveLength(callsBefore);
    expect(
      result.artifacts.filter((a: any) => a.kind === 'thumbnail'),
    ).toHaveLength(0);
  });
  it('invalidates old packaging and images after a script story change without generating unrequested images', async () => {
    const first = await submit();
    const original = await complete(first.runId);
    const target: any = original.artifacts.find(
      (a: any) => a.kind === 'script',
    );
    planOverrides = {
      action: 'revise',
      deliverables: ['script'],
      thumbnails: false,
      newEpisode: false,
    };
    const provider = ai.chat.getMockImplementation();
    ai.chat.mockImplementation(async (params: any) =>
      params.systemPromptOverride === SCRIPT_PROMPT
        ? {
            content: JSON.stringify({
              ...script,
              sections: [
                {
                  ...script.sections[0],
                  blocks: [{ lines: [Array(130).fill('medical').join(' ')] }],
                },
              ],
            }),
          }
        : provider(params),
    );
    const revision = await service.revision(threadId, String(target._id), {
      content: 'Change the story to prison medical care, 1 minute.',
      clientRequestId: 'new-story',
    });
    await complete(revision.runId);
    const old = await service.snapshot(threadId, first.runId);
    expect(
      old.artifacts
        .filter((a: any) => ['packaging', 'thumbnail'].includes(a.kind))
        .every((a: any) => a.outdated),
    ).toBe(true);
    expect(ai.generateStudioScene).toHaveBeenCalledTimes(2);
  });
  it('reconciles a mismatched package with the finished script using a bounded correction', async () => {
    const provider = ai.chat.getMockImplementation();
    let checks = 0;
    ai.chat.mockImplementation(async (params: any) => {
      const input = JSON.parse(params.messages[0].content);
      if (
        params.systemPromptOverride === REVIEW_PROMPT &&
        input.kind === 'package-alignment'
      ) {
        checks++;
        return {
          content: JSON.stringify(
            checks === 1
              ? {
                  status: 'repair',
                  issues: ['Family focus is missing from packaging'],
                  instruction: 'Use the family phone call in both variants.',
                }
              : { status: 'pass', issues: [] },
          ),
        };
      }
      if (
        params.systemPromptOverride === PACKAGE_PROMPT &&
        input.correction?.issues?.includes(
          'Family focus is missing from packaging',
        )
      )
        return {
          content: JSON.stringify({
            title: 'The family call',
            rationale: 'Matches the final script',
            thumbnails: [
              { ...concept, text: 'THE CALL MY FAMILY NEVER FORGOT' },
              { ...concept, text: 'WHAT DO I TELL MY CHILDREN?' },
            ],
          }),
        };
      return provider(params);
    });
    const request = await submit();
    const next = await complete(request.runId);
    const current = next.artifacts.filter(
      (a: any) => a.kind === 'thumbnail' && !a.outdated,
    );
    expect(current).toHaveLength(2);
    expect(current.every((a: any) => a.corrections === 1)).toBe(true);
    expect(current.map((a: any) => a.data.concept.text)).toContain(
      'WHAT DO I TELL MY CHILDREN?',
    );
    expect(next.status).toBe('completed');
    expect(checks).toBe(2);
    expect(ai.generateStudioScene).toHaveBeenCalledTimes(2);
  });
  it('returns a connected revision history and enforces its thread ownership', async () => {
    const first = await submit();
    const original = await complete(first.runId);
    let target: any = original.artifacts.find((a: any) => a.kind === 'script');
    planOverrides = {
      action: 'format',
      deliverables: ['script'],
      thumbnails: false,
      newEpisode: false,
    };
    for (const id of ['version-two', 'version-three']) {
      const revision = await service.revision(threadId, String(target._id), {
        content: 'Format this script',
        clientRequestId: id,
      });
      target = (await complete(revision.runId)).artifacts.find(
        (a: any) => a.kind === 'script',
      );
    }
    const versions = await service.versions(threadId, String(target._id));
    expect(versions.map((a: any) => a.version)).toEqual([1, 2, 3]);
    await expect(
      service.versions(String(new Types.ObjectId()), String(target._id)),
    ).rejects.toThrow('not found');
  });
  it('finds prior topic coverage older than the latest hundred uploads', async () => {
    await models.Video.insertMany([
      ...Array.from({ length: 105 }, (_, i) => ({
        channelId: new Types.ObjectId(channelId),
        title: 'Unrelated topic ' + i,
        publishedAt: new Date(2026, 0, i + 1),
      })),
      {
        channelId: new Types.ObjectId(channelId),
        title: 'Keefe D family phone call',
        publishedAt: new Date(2020, 0, 1),
      },
    ]);
    const request = await submit();
    await service.execute(request.runId);
    const next = await service.snapshot(threadId, request.runId);
    expect(next.research.covered.map((video: any) => video.title)).toContain(
      'Keefe D family phone call',
    );
    expect(next.research.coverage.matchedCount).toBe(1);
  });

  it('keeps a newer user revision current when an older job finishes late', async () => {
    const first = await submit();
    const original = await complete(first.runId);
    const target: any = original.artifacts.find(
      (a: any) => a.kind === 'script',
    );
    planOverrides = {
      action: 'format',
      deliverables: ['script'],
      thumbnails: false,
      newEpisode: false,
    };
    const older = await service.revision(threadId, String(target._id), {
      content: 'Format this script',
      clientRequestId: 'older-edit',
    });
    const newer = await service.revision(threadId, String(target._id), {
      content: 'Format this script',
      clientRequestId: 'newer-edit',
    });
    const recent = await complete(newer.runId);
    const late = await complete(older.runId);
    const recentScript: any = recent.artifacts.find(
      (a: any) => a.kind === 'script',
    );
    const lateScript: any = late.artifacts.find(
      (a: any) => a.kind === 'script',
    );
    expect(lateScript.outdated).toBe(true);
    expect(late.status).toBe('completed_with_issues');
    expect(
      String((await models.ContentArtifact.findById(target._id)).supersededBy),
    ).toBe(String(recentScript._id));
  });
  it('preserves script and packaging requests alongside a selected image edit', async () => {
    const first = await submit();
    const original = await complete(first.runId);
    const target: any = original.artifacts.find(
      (a: any) => a.kind === 'thumbnail',
    );
    planOverrides = {
      action: 'revise',
      deliverables: ['scene', 'script', 'packaging'],
      thumbnails: false,
      newEpisode: false,
    };
    const provider = ai.chat.getMockImplementation();
    ai.chat.mockImplementation(async (params: any) => {
      if (params.systemPromptOverride.includes('Return JSON {concept:'))
        return {
          content: JSON.stringify({
            concept: { ...concept, text: 'MY FAMILY WAITED FOR THIS CALL' },
            textOnly: true,
          }),
        };
      if (params.systemPromptOverride === PACKAGE_PROMPT)
        return {
          content: JSON.stringify({
            title: 'The family call',
            rationale: 'Preserved scene',
            thumbnails: [],
          }),
        };
      return provider(params);
    });
    const revision = await service.revision(threadId, String(target._id), {
      content:
        'Change this image headline. Also revise the 1-minute script and title.',
      clientRequestId: 'image-plus-script',
    });
    const next = await complete(revision.runId);
    expect(
      next.artifacts
        .filter((a: any) => !a.outdated)
        .map((a: any) => a.kind)
        .sort(),
    ).toEqual(['packaging', 'script', 'thumbnail', 'thumbnail']);
    expect(ai.generateStudioScene).toHaveBeenCalledTimes(2);
  });
  it('turns typed feedback into an edit of the existing scene for the right image', async () => {
    const first = await submit();
    const original = await complete(first.runId);
    const images: any[] = original.artifacts
      .filter((a: any) => a.kind === 'thumbnail')
      .sort((a: any, b: any) => a.data.variantIndex - b.data.variantIndex);
    const secondImage = images[1];
    planOverrides = {
      action: 'revise',
      deliverables: ['scene'],
      thumbnails: true,
      newEpisode: false,
      targets: [
        { artifactId: String(secondImage._id), change: 'add head bandage and tears' },
      ],
      clientRequestedDetails: ['head bandage'],
    };
    const provider = ai.chat.getMockImplementation();
    ai.chat.mockImplementation(async (params: any) => {
      if (params.systemPromptOverride.includes('Return JSON {concept:'))
        return {
          content: JSON.stringify({
            concept: { ...concept, visual: 'Same man with a head bandage and tears' },
            mode: 'edit',
            sceneChange: 'add a head bandage and more tears',
            clientRequestedDetails: ['tears'],
          }),
        };
      return provider(params);
    });
    const feedback = await service.submit(threadId, {
      content: 'make image 2 more emotional, add a head bandage and tears',
      clientRequestId: 'typed-feedback',
    });
    const next = await complete(feedback.runId);
    const created = next.artifacts.filter((a: any) => a.runId && String(a.runId) === feedback.runId);
    expect(created.map((a: any) => a.kind)).toEqual(['thumbnail']);
    expect(created[0].data.variantIndex).toBe(1);
    expect(String(created[0].sourceArtifactId)).toBe(String(secondImage._id));
    expect(created[0].data.clientRequestedDetails.sort()).toEqual(['head bandage', 'tears']);
    // Exactly one new provider call, and it edits the stored clean scene.
    expect(ai.generateStudioScene).toHaveBeenCalledTimes(3);
    const call = ai.generateStudioScene.mock.calls[2][0];
    expect(call.baseImageUrl).toBe(secondImage.data.cleanBackgroundUrl);
    expect(call.editInstruction).toContain('bandage');
    expect(call.clientRequestedDetails).toContain('head bandage');
    // No new pair, script or packaging; the other image is untouched.
    expect(
      await models.ContentArtifact.countDocuments({ _id: images[0]._id, outdated: { $ne: true } }),
    ).toBe(1);
    expect(
      await models.ContentRunEvent.countDocuments({ runId: feedback.runId, type: 'ack' }),
    ).toBe(1);
  });
  it('applies ambiguous feedback to both images without asking and avoids paid scenes for text edits', async () => {
    const first = await submit();
    const original = await complete(first.runId);
    const images: any[] = original.artifacts
      .filter((a: any) => a.kind === 'thumbnail')
      .sort((a: any, b: any) => a.data.variantIndex - b.data.variantIndex);
    planOverrides = {
      action: 'revise',
      deliverables: ['scene'],
      thumbnails: false,
      newEpisode: false,
      questions: [],
      targets: images.map((a: any) => ({ artifactId: String(a._id), change: 'smaller headline' })),
    };
    const provider = ai.chat.getMockImplementation();
    ai.chat.mockImplementation(async (params: any) =>
      params.systemPromptOverride.includes('Return JSON {concept:')
        ? { content: JSON.stringify({ concept: { ...concept, text: 'I COULD NOT SAY IT' }, mode: 'text', sceneChange: '', clientRequestedDetails: [] }) }
        : provider(params),
    );
    const feedback = await service.submit(threadId, {
      content: 'the headline is too big',
      clientRequestId: 'both-images',
    });
    const next = await complete(feedback.runId);
    const created = next.artifacts.filter((a: any) => String(a.runId) === feedback.runId);
    expect(created).toHaveLength(2);
    expect(created.map((a: any) => a.data.variantIndex).sort()).toEqual([0, 1]);
    expect(next.status).not.toBe('waiting_for_input');
    expect(ai.generateStudioScene).toHaveBeenCalledTimes(2);
  });
  it('carries dependency links through formatting before a later story revision', async () => {
    const first = await submit();
    const original = await complete(first.runId);
    let target: any = original.artifacts.find((a: any) => a.kind === 'script');
    planOverrides = {
      action: 'format',
      deliverables: ['script'],
      thumbnails: false,
      newEpisode: false,
    };
    const formatting = await service.revision(threadId, String(target._id), {
      content: 'Format this script',
      clientRequestId: 'format-before-rewrite',
    });
    target = (await complete(formatting.runId)).artifacts.find(
      (a: any) => a.kind === 'script',
    );
    planOverrides = {
      action: 'revise',
      deliverables: ['script'],
      thumbnails: false,
      newEpisode: false,
    };
    const provider = ai.chat.getMockImplementation();
    ai.chat.mockImplementation(async (params: any) =>
      params.systemPromptOverride === SCRIPT_PROMPT
        ? {
            content: JSON.stringify({
              ...script,
              sections: [
                {
                  ...script.sections[0],
                  blocks: [{ lines: [Array(130).fill('hospital').join(' ')] }],
                },
              ],
            }),
          }
        : provider(params),
    );
    const rewritten = await service.revision(threadId, String(target._id), {
      content: 'Rewrite the story around prison medical care, 1 minute',
      clientRequestId: 'rewrite-after-format',
    });
    await complete(rewritten.runId);
    expect(
      (await service.snapshot(threadId, first.runId)).artifacts
        .filter((a: any) => ['packaging', 'thumbnail'].includes(a.kind))
        .every((a: any) => a.outdated),
    ).toBe(true);
  });
  it('recovers changed packaging without exceeding an already used image correction budget', async () => {
    const request = await submit();
    const original = await complete(request.runId);
    const packaging: any = original.artifacts.find(
      (a: any) => a.kind === 'packaging',
    );
    const images: any[] = original.artifacts.filter(
      (a: any) => a.kind === 'thumbnail',
    );
    await models.ContentArtifact.updateOne(
      { _id: packaging._id },
      {
        $set: {
          'data.thumbnails': [
            { ...concept, text: 'THE CALL MY FAMILY REMEMBERS' },
            { ...concept, text: 'THE WORDS I COULD NOT SAY' },
          ],
          corrections: 1,
        },
      },
    );
    await models.ContentArtifact.updateOne(
      { _id: images[0]._id },
      { $set: { corrections: 1 } },
    );
    await models.ContentRun.updateOne(
      { _id: request.runId },
      { $set: { status: 'queued' } },
    );
    const recovered = await complete(request.runId);
    const current = recovered.artifacts.filter(
      (a: any) => a.kind === 'thumbnail' && !a.outdated,
    );
    expect(current).toHaveLength(2);
    expect(
      current.filter((a: any) => a.status === 'needs_attention'),
    ).toHaveLength(1);
    expect(recovered.status).toBe('completed_with_issues');
    expect(ai.generateStudioScene).toHaveBeenCalledTimes(3);
    // Replaying the coordinator cannot create another paid correction.
    await models.ContentRun.updateOne(
      { _id: request.runId },
      { $set: { status: 'queued' } },
    );
    await complete(request.runId);
    expect(ai.generateStudioScene).toHaveBeenCalledTimes(3);
  });
  it('resolves the selected final image rather than a newer revision sharing its clean scene', async () => {
    const first = await submit();
    const original = await complete(first.runId);
    const selected: any = original.artifacts.find(
      (a: any) => a.kind === 'thumbnail',
    );
    const sibling = await models.ContentArtifact.create({
      channelId,
      threadId,
      episodeId: selected.episodeId,
      runId: new Types.ObjectId(),
      key: 'other-revision',
      kind: 'thumbnail',
      status: 'ready',
      sourceArtifactId: selected._id,
      rootArtifactId: selected._id,
      version: 2,
      data: {
        ...selected.data,
        url: 'https://example.test/newer-headline.png',
      },
    });
    const revision = await service.reviseImageByUrl(threadId, {
      baseImageUrl: selected.data.cleanBackgroundUrl,
      sourceImageUrl: selected.data.url,
      prompt: 'Edit this selected version',
      clientRequestId: 'selected-final-image',
    });
    const run = await models.ContentRun.findById(revision!.runId);
    expect(String(run.targetArtifactId)).toBe(String(selected._id));
    expect(String(run.targetArtifactId)).not.toBe(String(sibling._id));
  });
  it('keeps a generated image visible when the model returns a malformed review', async () => {
    const request = await submit();
    await service.execute(request.runId);
    const provider = ai.chat.getMockImplementation();
    ai.chat.mockImplementation(async (params: any) => {
      const input = JSON.parse(params.messages[0].content);
      if (params.systemPromptOverride === REVIEW_PROMPT && input.concept)
        return {
          content: JSON.stringify({
            status: 'repair',
            issues: [{ message: 'Not a valid issue string' }],
          }),
        };
      return provider(params);
    });
    const image: any = (
      await service.snapshot(threadId, request.runId)
    ).artifacts.find((a: any) => a.kind === 'thumbnail');
    await service.executeImage(String(image._id));
    const result = await models.ContentArtifact.findById(image._id);
    expect(result.status).toBe('needs_attention');
    expect(result.data.url).toBeTruthy();
    expect(result.review.issues).toEqual(['Image review unavailable']);
  });
});

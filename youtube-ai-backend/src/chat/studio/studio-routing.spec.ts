import { ChatController } from '../chat.controller';

describe('studio routing at legacy image entry points', () => {
  const channel = {
    enabled: jest.fn(),
    submit: jest.fn(),
    reviseImageByUrl: jest.fn(),
  };
  const legacy = { generateImageDirect: jest.fn(), editImage: jest.fn() };
  const router = { useStudio: jest.fn() };
  const controller = new ChatController(
    legacy as any,
    channel as any,
    router as any,
    {} as any,
  );
  beforeEach(() => jest.resetAllMocks());
  it('routes a mixed image-mode request through the coordinator unchanged', async () => {
    channel.enabled.mockResolvedValue(true);
    channel.submit.mockResolvedValue({ runId: 'run' });
    const prompt =
      'Write a script, title and two thumbnails for the family phone call';
    await expect(
      controller.generateImageDirect('thread', { prompt }),
    ).resolves.toEqual({ runId: 'run' });
    expect(channel.submit).toHaveBeenCalledWith(
      'thread',
      expect.objectContaining({ content: prompt, skill: 'image' }),
    );
    expect(legacy.generateImageDirect).not.toHaveBeenCalled();
  });
  it('uses artifact revisions for studio images', async () => {
    channel.enabled.mockResolvedValue(true);
    channel.reviseImageByUrl.mockResolvedValue({ runId: 'revision' });
    const body = {
      prompt: 'Change only the expression',
      baseImageUrl: 'https://assets.test/scene.png',
    };
    await expect(controller.editImage('thread', body)).resolves.toEqual({
      runId: 'revision',
    });
    expect(legacy.editImage).not.toHaveBeenCalled();
  });
  it('retains explicit legacy editing for images without a studio artifact', async () => {
    channel.enabled.mockResolvedValue(true);
    channel.reviseImageByUrl.mockResolvedValue(null);
    await controller.editImage('thread', {
      prompt: 'Edit this old image',
      baseImageUrl: '/old.png',
    });
    expect(legacy.editImage).toHaveBeenCalledTimes(1);
  });
});

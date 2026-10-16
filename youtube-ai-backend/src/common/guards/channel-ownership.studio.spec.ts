import { Types } from 'mongoose';
import { ChannelOwnershipGuard } from './channel-ownership.guard';
const selected = (value: unknown) => ({
  select: () => ({ lean: async () => value }),
});
describe('nested studio ownership', () => {
  it('does not let a body videoId override the thread owner', async () => {
    const user = String(new Types.ObjectId()),
      other = String(new Types.ObjectId());
    const channel = new Types.ObjectId(),
      thread = new Types.ObjectId();
    const videoModel = {
      findById: jest.fn(() => selected({ channelId: channel })),
    };
    const guard = new ChannelOwnershipGuard(
      { findById: () => selected({ userId: other }) } as never,
      videoModel as never,
      { findById: () => selected({ channelId: channel }) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { findById: () => selected({ role: 'USER' }) } as never,
    );
    const request = {
      user: { id: user },
      params: { id: String(thread), runId: String(new Types.ObjectId()) },
      body: { videoId: String(new Types.ObjectId()) },
      route: { path: '/threads/:id/runs/:runId' },
    };
    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => request }),
      } as never),
    ).rejects.toThrow('do not own');
    expect(videoModel.findById).not.toHaveBeenCalled();
  });
});

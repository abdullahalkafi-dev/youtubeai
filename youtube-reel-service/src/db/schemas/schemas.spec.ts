import { ReelCampaignSchema } from './reel-campaign.schema';
import { ReelSchema } from './reel.schema';
import { ReelMomentSchema } from './reel-moment.schema';
import { ReelSourceSchema } from './reel-source.schema';
import { ReelEntitySchema } from './reel-misc.schema';
import { SharedChannelSchema, SourceVideoSchema } from './shared.readonly';

/** Id fields must be real ObjectId paths, otherwise string ids from routes/jobs silently match nothing. */
describe('schema id types', () => {
  it.each([
    [ReelCampaignSchema, ['channelId', 'userId']],
    [ReelSchema, ['campaignId', 'channelId']],
    [ReelMomentSchema, ['channelId', 'videoId']],
    [ReelSourceSchema, ['channelId', 'videoId']],
    [ReelEntitySchema, ['channelId']],
    [SourceVideoSchema, ['channelId']],
    [SharedChannelSchema, ['userId']],
  ])('%#: ObjectId paths', (schema, paths) => {
    for (const p of paths as string[]) expect((schema as any).path(p).instance).toBe('ObjectId');
  });

  it('casts array id fields', () => {
    expect((ReelSchema.path('momentIds') as any).caster.instance).toBe('ObjectId');
  });
});

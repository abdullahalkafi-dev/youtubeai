import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Request } from 'express';
import { Channel, ChannelDocument } from '../../mongo/schemas/channel.schema';
import { User, UserDocument } from '../../mongo/schemas/user.schema';
import { Video, VideoDocument } from '../../mongo/schemas/video.schema';
import { Thread, ThreadDocument } from '../../mongo/schemas/thread.schema';
import { SeoSuggestion, SeoSuggestionDocument } from '../../mongo/schemas/seo-suggestion.schema';
import { SeoVersion, SeoVersionDocument } from '../../mongo/schemas/seo-version.schema';
import { QueueItem, QueueItemDocument } from '../../mongo/schemas/queue-item.schema';
import { TrendingTopic, TrendingTopicDocument } from '../../mongo/schemas/trending-topic.schema';

interface AuthenticatedRequest extends Request {
  user?: { id: string; email: string };
  params: Record<string, string>;
  route: { path: string };
}

@Injectable()
export class ChannelOwnershipGuard implements CanActivate {
  constructor(
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @InjectModel(Thread.name) private readonly threadModel: Model<ThreadDocument>,
    @InjectModel(SeoSuggestion.name) private readonly seoSuggestionModel: Model<SeoSuggestionDocument>,
    @InjectModel(SeoVersion.name) private readonly seoVersionModel: Model<SeoVersionDocument>,
    @InjectModel(QueueItem.name) private readonly queueItemModel: Model<QueueItemDocument>,
    @InjectModel(TrendingTopic.name) private readonly trendingTopicModel: Model<TrendingTopicDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    // Admin users can access any channel
    const user = await this.userModel.findById(userId).select('role').lean();
    if (user?.role === 'ADMIN') {
      return true;
    }

    const params = request.params;
    const routePath = request.route?.path || request.path;

    // Mode 1: Direct channel access (route has :channelId)
    if (params.channelId) {
      return this.checkChannelOwnership(params.channelId, userId);
    }

    // Mode 1b: Direct channel access via :id param on /channels/ routes
    if (params.id && routePath.includes('/channels/')) {
      return this.checkChannelOwnership(params.id, userId);
    }

    // Mode 1c: Video-based access (route has :videoId, e.g. /videos/:videoId/comments)
    if (params.videoId) {
      return this.checkVideoOwnership(params.videoId, userId);
    }

    // Mode 1d: Body-based videoId (e.g. POST /seo/generate with { videoId } in body)
    if (request.body?.videoId) {
      return this.checkVideoOwnership(request.body.videoId, userId);
    }

    // Mode 2: Resource access (route has :id, need to find channelId)
    if (params.id) {
      const channelId = await this.findChannelIdFromResource(
        params.id,
        routePath,
      );
      if (!channelId) {
        throw new NotFoundException('Resource not found');
      }
      return this.checkChannelOwnership(channelId, userId);
    }

    // No recognized resource identifier — deny access
    throw new ForbiddenException('No resource identifier in request');
  }

  private async checkChannelOwnership(
    channelId: string,
    userId: string,
  ): Promise<boolean> {
    const channel = await this.channelModel.findById(channelId).select('userId').lean();
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.userId.toString() !== userId) {
      throw new ForbiddenException('You do not own this channel');
    }

    return true;
  }

  private async checkVideoOwnership(
    videoId: string,
    userId: string,
  ): Promise<boolean> {
    const video = await this.videoModel.findById(videoId).select('channelId').lean();
    if (!video) {
      throw new NotFoundException('Video not found');
    }

    const channel = await this.channelModel.findById(video.channelId).select('userId').lean();
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    if (channel.userId.toString() !== userId) {
      throw new ForbiddenException('You do not own this channel');
    }

    return true;
  }

  private async findChannelIdFromResource(
    resourceId: string,
    routePath: string,
  ): Promise<string | null> {
    if (!resourceId || resourceId === 'undefined' || resourceId === 'null') {
      return null;
    }

    if (!Types.ObjectId.isValid(resourceId)) {
      return null;
    }

    if (routePath.includes('/videos/')) {
      const resource = await this.videoModel.findById(resourceId).select('channelId').lean();
      return resource?.channelId?.toString() ?? null;
    }

    if (routePath.includes('/threads/')) {
      const resource = await this.threadModel.findById(resourceId).select('channelId').lean();
      return resource?.channelId?.toString() ?? null;
    }

    if (routePath.includes('/seo/suggestions/')) {
      const resource = await this.seoSuggestionModel.findById(resourceId).select('channelId').lean();
      return resource?.channelId?.toString() ?? null;
    }

    if (routePath.includes('/seo/versions/')) {
      const resource = await this.seoVersionModel.findById(resourceId).select('videoId').lean();
      if (!resource?.videoId) return null;
      const video = await this.videoModel.findById(resource.videoId).select('channelId').lean();
      return video?.channelId?.toString() ?? null;
    }

    if (routePath.includes('/queue/')) {
      const resource = await this.queueItemModel.findById(resourceId).select('channelId').lean();
      return resource?.channelId?.toString() ?? null;
    }

    if (routePath.includes('/trending-ideas/')) {
      const resource = await this.trendingTopicModel.findById(resourceId).select('channelId').lean();
      return resource?.channelId?.toString() ?? null;
    }

    return null;
  }
}

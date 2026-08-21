import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { CommentsService } from './comments.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { User, UserDocument } from '../mongo/schemas/user.schema';
import { YouTubeService } from '../youtube/youtube.service';

@Controller('videos/:videoId/comments')
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class CommentsController {
  private readonly logger = new Logger(CommentsController.name);

  constructor(
    private readonly commentsService: CommentsService,
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly youtubeService: YouTubeService,
  ) {}

  @Get()
  async getComments(
    @Param('videoId') videoId: string,
    @Query('pageToken') pageToken?: string,
    @Query('order') order?: string,
  ) {
    const ctx = await this.getVideoContext(videoId);
    if (ctx.demoMode) return { comments: [], commentsDisabled: false, totalCount: 0, nextPageToken: null, demoMode: true };
    const validOrder = order === 'time' ? 'time' : 'relevance';
    return this.commentsService.getComments(
      ctx.youtubeId,
      ctx.channelId,
      ctx.accessToken!,
      pageToken,
      validOrder,
      ctx.channelYoutubeId,
      ctx.channelName,
    );
  }

  @Get(':commentId/replies')
  async getReplies(
    @Param('videoId') videoId: string,
    @Param('commentId') commentId: string,
    @Query('pageToken') pageToken?: string,
  ) {
    const ctx = await this.getVideoContext(videoId);
    if (ctx.demoMode) return { replies: [], nextPageToken: null, demoMode: true };
    return this.commentsService.getReplies(
      ctx.youtubeId,
      commentId,
      ctx.channelId,
      ctx.accessToken!,
      pageToken,
      ctx.channelYoutubeId,
      ctx.channelName,
    );
  }

  @Post('sync')
  async syncComments(@Param('videoId') videoId: string, @Body() body?: { order?: string }) {
    const ctx = await this.getVideoContext(videoId);
    if (ctx.demoMode) return { comments: [], commentsDisabled: false, totalCount: 0, nextPageToken: null, demoMode: true };
    const validOrder = body?.order === 'time' ? 'time' : 'relevance';
    return this.commentsService.syncComments(
      ctx.youtubeId,
      ctx.channelId,
      ctx.accessToken!,
      validOrder,
      ctx.channelYoutubeId,
      ctx.channelName,
    );
  }

  @Post('generate-reply')
  async generateReply(
    @Param('videoId') videoId: string,
    @Body() body: { commentId: string; commentText: string },
  ) {
    const video = await this.videoModel.findById(videoId).lean();
    if (!video) throw new NotFoundException('Video not found');
    const channel = await this.channelModel.findById(video.channelId).lean();
    const replies = await this.commentsService.generateReplies(
      body.commentText,
      video.title || 'Unknown Video',
      channel?.name || 'Unique Mecca Audio',
      channel?.id || '',
      video.description || '',
    );
    return {
      reply: replies[0]?.text || '',
      replies,
    };
  }

  @Post('generate-replies')
  async generateReplies(
    @Param('videoId') videoId: string,
    @Body() body: { commentId: string; commentText: string },
  ) {
    const video = await this.videoModel.findById(videoId).lean();
    if (!video) throw new NotFoundException('Video not found');
    const channel = await this.channelModel.findById(video.channelId).lean();
    const replies = await this.commentsService.generateReplies(
      body.commentText,
      video.title || 'Unknown Video',
      channel?.name || 'Unique Mecca Audio',
      channel?.id || '',
      video.description || '',
    );
    return {
      reply: replies[0]?.text || '',
      replies,
    };
  }

  @Post('reply')
  async postReply(@Param('videoId') videoId: string, @Body() body: { parentId: string; text: string }) {
    const ctx = await this.getVideoContext(videoId);
    if (ctx.demoMode) return { success: true, mock: true, commentId: `mock_${Date.now()}` };
    return this.commentsService.postReply(videoId, body.parentId, body.text, ctx.channelId, ctx.accessToken!);
  }

  private async getVideoContext(videoId: string) {
    const video = await this.videoModel.findById(videoId).lean();
    if (!video) throw new NotFoundException('Video not found');

    const channel = await this.channelModel.findById(video.channelId).lean();
    const channelYoutubeId = channel?.youtubeChannelId || '';
    const channelName = channel?.name || '';

    if (!channel?.userId) {
      this.logger.warn(`Demo mode: channel ${video.channelId} has no userId linked`);
      return {
        channelId: video.channelId.toString(),
        youtubeId: video.youtubeId,
        accessToken: null,
        channelYoutubeId,
        channelName,
        demoMode: true,
      };
    }

    const user = await this.userModel.findById(channel.userId).lean();

    if (!user?._id) {
      this.logger.warn(`Demo mode: user not found for channel ${video.channelId}, userId=${channel.userId}`);
      return {
        channelId: video.channelId.toString(),
        youtubeId: video.youtubeId,
        accessToken: null,
        channelYoutubeId,
        channelName,
        demoMode: true,
      };
    }

    try {
      const accessToken = await this.youtubeService.getValidAccessToken(user._id.toString());
      return {
        channelId: video.channelId.toString(),
        youtubeId: video.youtubeId,
        accessToken,
        channelYoutubeId,
        channelName,
        demoMode: false,
      };
    } catch (error: any) {
      this.logger.warn(`Demo mode: OAuth token failed for user ${user._id} — ${error?.code || error?.message || error}`);
      return {
        channelId: video.channelId.toString(),
        youtubeId: video.youtubeId,
        accessToken: null,
        channelYoutubeId,
        channelName,
        demoMode: true,
      };
    }
  }
}

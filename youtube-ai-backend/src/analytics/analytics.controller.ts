import { Controller, Get, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { YoutubeAnalyticsService } from '../youtube/youtube-analytics.service';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

@Controller('channels/:channelId/analytics')
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: YoutubeAnalyticsService,
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
  ) {}

  private async getDateRange(period: string = '30') {
    const days = parseInt(period, 10);
    if (isNaN(days) || days < 1 || days > 365) {
      throw new BadRequestException('period must be a number between 1 and 365');
    }
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];
    return { startDate, endDate };
  }

  private async getChannel(channelId: string) {
    const channel = await this.channelModel.findById(channelId).lean();
    if (!channel?.userId || !channel?.youtubeChannelId) {
      throw new BadRequestException('Channel missing userId or youtubeChannelId');
    }
    return { userId: channel.userId.toString(), youtubeChannelId: channel.youtubeChannelId };
  }

  @Get('search-terms')
  async getSearchTerms(
    @Param('channelId') channelId: string,
    @Query('period') period?: string,
  ) {
    const { userId, youtubeChannelId } = await this.getChannel(channelId);
    const { startDate, endDate } = await this.getDateRange(period);
    return this.analyticsService.getSearchTerms(userId, youtubeChannelId, startDate, endDate);
  }

  @Get('traffic-sources')
  async getTrafficSources(
    @Param('channelId') channelId: string,
    @Query('period') period?: string,
  ) {
    const { userId, youtubeChannelId } = await this.getChannel(channelId);
    const { startDate, endDate } = await this.getDateRange(period);
    return this.analyticsService.getTrafficSources(userId, youtubeChannelId, startDate, endDate);
  }

  @Get('retention')
  async getRetention(
    @Param('channelId') channelId: string,
    @Query('period') period?: string,
  ) {
    const { userId, youtubeChannelId } = await this.getChannel(channelId);
    const { startDate, endDate } = await this.getDateRange(period);
    return this.analyticsService.getRetentionOverTime(userId, youtubeChannelId, startDate, endDate);
  }

  @Get('revenue')
  async getRevenue(
    @Param('channelId') channelId: string,
    @Query('period') period?: string,
  ) {
    const { userId, youtubeChannelId } = await this.getChannel(channelId);
    const { startDate, endDate } = await this.getDateRange(period);
    return this.analyticsService.getRevenueOverTime(userId, youtubeChannelId, startDate, endDate);
  }

  @Get('top-videos')
  async getTopVideos(
    @Param('channelId') channelId: string,
    @Query('period') period?: string,
    @Query('limit') limit?: string,
  ) {
    const { userId, youtubeChannelId } = await this.getChannel(channelId);
    const { startDate, endDate } = await this.getDateRange(period);
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.analyticsService.getTopVideosByWatchTime(userId, youtubeChannelId, startDate, endDate, limitNum);
  }
}

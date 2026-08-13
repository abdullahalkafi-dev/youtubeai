import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { TrendsService } from './trends.service';

@Controller('channels/:channelId/trends')
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class TrendsController {
  constructor(private readonly trendsService: TrendsService) {}

  @Get()
  async getTrends(
    @Param('channelId') channelId: string,
    @Query('days') days?: string,
  ) {
    const daysNum = days ? parseInt(days, 10) : undefined;
    return this.trendsService.getTrends(channelId, daysNum);
  }

  @Post('refresh')
  async refreshTrends(@Param('channelId') channelId: string) {
    return this.trendsService.startRefresh(channelId);
  }

  @Get('refresh/status')
  async refreshStatus(@Param('channelId') channelId: string) {
    return this.trendsService.getRefreshStatus(channelId);
  }

  @Post('seed-thread')
  async seedThread(
    @Param('channelId') channelId: string,
    @Body() body: { topicId: string },
  ) {
    return this.trendsService.seedThread(channelId, body.topicId);
  }
}

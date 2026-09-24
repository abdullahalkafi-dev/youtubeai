import { Controller, Get, Param, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { QuotaService } from './quota.service';

@Controller('channels/:channelId/quota')
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class QuotaController {
  constructor(private readonly quotaService: QuotaService) {}

  @Get()
  async getDailyUsage(@Param('channelId') channelId: string) {
    const data = await this.quotaService.getDailyUsage(channelId);
    const comments = await this.quotaService.getCommentsDailyUsage(channelId);
    return {
      ...data,
      comments,
      commentsBudgetExhausted: this.quotaService.isCommentsBudgetExhausted(),
      dataApiExhausted: this.quotaService.isDataApiExhausted(),
    };
  }

  @Get('comments')
  async getCommentsUsage(@Param('channelId') channelId: string) {
    const comments = await this.quotaService.getCommentsDailyUsage(channelId);
    return {
      ...comments,
      exhausted: this.quotaService.isCommentsBudgetExhausted(),
    };
  }

  @Get('analytics')
  async getAnalyticsDailyUsage(@Param('channelId') channelId: string) {
    return this.quotaService.getAnalyticsDailyUsage(channelId);
  }

  @Get('logs')
  async getRecentLogs(
    @Param('channelId') channelId: string,
    @Query('limit') limit?: string,
  ) {
    return this.quotaService.getRecentLogs(
      channelId,
      limit ? parseInt(limit, 10) : 50,
    );
  }
}

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
    return this.quotaService.getDailyUsage(channelId);
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

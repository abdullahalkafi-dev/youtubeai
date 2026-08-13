import { Controller, Get, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { RevivalService } from './revival.service';

@Controller('channels/:channelId/revival')
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class RevivalController {
  constructor(private readonly revivalService: RevivalService) {}

  @Get('priority')
  async getRevivalPriority(
    @Param('channelId') channelId: string,
    @Query('period') period?: string,
  ) {
    const periodNum = period ? parseInt(period, 10) : 90;
    if (isNaN(periodNum) || periodNum < 1 || periodNum > 365) {
      throw new BadRequestException('period must be a number between 1 and 365');
    }
    return this.revivalService.getRevivalPriority(channelId, periodNum);
  }

  @Get('search-terms')
  async getSearchTerms(
    @Param('channelId') channelId: string,
    @Query('period') period?: string,
  ) {
    const periodNum = period ? parseInt(period, 10) : 90;
    if (isNaN(periodNum) || periodNum < 1 || periodNum > 365) {
      throw new BadRequestException('period must be a number between 1 and 365');
    }
    return this.revivalService.getSearchTermsSummary(channelId, periodNum);
  }
}

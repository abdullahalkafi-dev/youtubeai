import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { KeywordsService } from './keywords.service';

@Controller('channels/:channelId/keywords')
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class KeywordsController {
  constructor(private readonly keywordsService: KeywordsService) {}

  @Get('research')
  async research(
    @Param('channelId') channelId: string,
    @Query('q') keyword: string,
  ) {
    return this.keywordsService.researchKeyword(channelId, keyword);
  }

  @Get('related')
  async related(@Query('q') keyword: string) {
    return this.keywordsService.getRelatedKeywords(keyword);
  }
}

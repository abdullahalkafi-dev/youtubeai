import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { CompetitorsService } from './competitors.service';

@Controller('channels/:channelId/competitors')
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class CompetitorsController {
  constructor(private readonly competitorsService: CompetitorsService) {}

  @Get()
  list(@Param('channelId') channelId: string) {
    return this.competitorsService.listCompetitors(channelId);
  }

  @Post('discover')
  discover(@Param('channelId') channelId: string) {
    return this.competitorsService.discoverCompetitors(channelId);
  }

  @Post()
  add(
    @Param('channelId') channelId: string,
    @Body() body: { youtubeChannelId: string },
  ) {
    return this.competitorsService.addCompetitor(
      channelId,
      body.youtubeChannelId,
    );
  }

  @Delete(':competitorId')
  remove(
    @Param('channelId') channelId: string,
    @Param('competitorId') competitorId: string,
  ) {
    return this.competitorsService.removeCompetitor(channelId, competitorId);
  }

  @Get('uploads')
  uploads(
    @Param('channelId') channelId: string,
    @Query('days') days?: string,
  ) {
    const daysNum = days ? parseInt(days, 10) : 30;
    return this.competitorsService.getCompetitorUploads(channelId, daysNum);
  }

  @Get('gaps')
  gaps(@Param('channelId') channelId: string) {
    return this.competitorsService.findContentGaps(channelId);
  }
}

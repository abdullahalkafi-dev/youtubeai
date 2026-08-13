import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { SeoService } from './seo.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { GenerateSeoDto } from './dto/seo.dto';

@Controller()
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class SeoController {
  constructor(private readonly seoService: SeoService) {}

  @Post('seo/generate')
  generate(@Body() dto: GenerateSeoDto) {
    return this.seoService.generateSeo(dto);
  }

  @Get('channels/:channelId/seo/suggestions')
  findAll(@Param('channelId') channelId: string) {
    return this.seoService.findAll(channelId);
  }

  @Patch('seo/suggestions/:id/approve')
  approve(@Param('id') id: string) {
    return this.seoService.approve(id);
  }

  @Patch('seo/suggestions/:id/reject')
  reject(@Param('id') id: string) {
    return this.seoService.reject(id);
  }

  @Get('videos/:videoId/seo-versions')
  getVersionHistory(@Param('videoId') videoId: string) {
    return this.seoService.getVersionHistory(videoId);
  }

  @Patch('seo/versions/:id/rollback')
  rollback(@Param('id') id: string) {
    return this.seoService.rollbackToVersion(id);
  }
}

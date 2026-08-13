import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { VideosService } from './videos.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { VideoQueryDto, UpdateVideoDto } from './dto/video-query.dto';

@Controller()
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Get('channels/:channelId/videos')
  findAll(
    @Param('channelId') channelId: string,
    @Query() query: VideoQueryDto,
  ) {
    return this.videosService.findAll(channelId, query);
  }

  @Get('channels/:channelId/videos/stats')
  getChannelStats(@Param('channelId') channelId: string) {
    return this.videosService.getChannelStats(channelId);
  }

  @Get('channels/:channelId/videos/drifted')
  getDriftedVideos(@Param('channelId') channelId: string) {
    return this.videosService.getDriftedVideos(channelId);
  }

  @Get('videos/:id')
  findOne(@Param('id') id: string) {
    return this.videosService.findById(id);
  }

  @Post('videos/:id/analytics')
  fetchAnalytics(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.videosService.fetchVideoAnalytics(id, userId);
  }

  @Post('videos/:id/pull-from-youtube')
  pullFromYoutube(@Param('id') id: string) {
    return this.videosService.pullFromYoutube(id);
  }

  @Post('videos/:id/push-to-youtube')
  pushToYoutube(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.videosService.pushToYoutube(id, userId);
  }

  @Patch('videos/:id')
  update(@Param('id') id: string, @Body() dto: UpdateVideoDto) {
    return this.videosService.update(id, dto);
  }

  @Delete('videos/:id')
  remove(@Param('id') id: string) {
    return this.videosService.remove(id);
  }
}

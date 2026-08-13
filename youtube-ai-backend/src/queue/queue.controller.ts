import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { QueueService } from './queue.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';

@Controller()
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Post('channels/:channelId/queue')
  addToQueue(
    @Param('channelId') channelId: string,
    @Body() body: { videoId: string; videoTitle: string },
  ) {
    return this.queueService.addToQueue(
      channelId,
      body.videoId,
      body.videoTitle,
    );
  }

  @Get('channels/:channelId/queue')
  findAll(@Param('channelId') channelId: string) {
    return this.queueService.findAll(channelId);
  }

  @Get('channels/:channelId/queue/stats')
  getStats(@Param('channelId') channelId: string) {
    return this.queueService.getStats(channelId);
  }

  @Delete('queue/:id')
  removeFromQueue(@Param('id') id: string) {
    return this.queueService.removeFromQueue(id);
  }

  @Post('channels/:channelId/queue/toggle')
  toggleQueue(@Param('channelId') channelId: string) {
    return this.queueService.toggleQueue(channelId);
  }
}

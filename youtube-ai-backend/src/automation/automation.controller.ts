import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AutomationService } from './automation.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { RunBatchDto, BatchQueryDto } from './dto/automation.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Get('channels/:channelId/automation/stats')
  @UseGuards(ChannelOwnershipGuard)
  getStats(@Param('channelId') channelId: string) {
    return this.automationService.getStats(channelId);
  }

  @Get('channels/:channelId/automation/batches')
  @UseGuards(ChannelOwnershipGuard)
  getBatches(
    @Param('channelId') channelId: string,
    @Query() query: BatchQueryDto,
  ) {
    return this.automationService.getBatches(channelId, query);
  }

  @Get('channels/:channelId/automation/active')
  @UseGuards(ChannelOwnershipGuard)
  getActiveBatch(@Param('channelId') channelId: string) {
    return this.automationService.getActiveBatch(channelId);
  }

  @Post('channels/:channelId/automation/run')
  @UseGuards(ChannelOwnershipGuard)
  runBatch(
    @Param('channelId') channelId: string,
    @Body() dto: RunBatchDto,
  ) {
    return this.automationService.runBatch(
      channelId,
      dto.batchSize || 30,
      dto.source || 'manual_ui_batch',
    );
  }

  @Post('automation/batches/:batchId/retry')
  retryFailedItems(@Param('batchId') batchId: string) {
    return this.automationService.retryFailedItems(batchId);
  }

  @Post('automation/batches/:batchId/cancel')
  cancelBatch(@Param('batchId') batchId: string) {
    return this.automationService.cancelBatch(batchId);
  }
}

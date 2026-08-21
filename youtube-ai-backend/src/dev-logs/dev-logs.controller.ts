import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DevLogsService } from './dev-logs.service';
import { QueryLogsDto, QueryStatsDto } from './dto/query-logs.dto';

@Controller('dev/logs')
@UseGuards(JwtAuthGuard)
export class DevLogsController {
  constructor(private readonly devLogsService: DevLogsService) {}

  /**
   * Get paginated logs with advanced multi-field search and filters
   */
  @Get()
  async getLogs(@Query() query: QueryLogsDto) {
    return this.devLogsService.getLogs(query);
  }

  /**
   * Get 14-day timeline aggregations and status distribution for visual charts
   */
  @Get('stats')
  async getStats(@Query() query: QueryStatsDto) {
    return this.devLogsService.getStats(query.days || 14);
  }

  /**
   * Diagnostic test endpoint: Simulates a 500 error to test real-time log ingestion
   */
  @Post('test-error')
  @HttpCode(HttpStatus.OK)
  triggerTestError(@Query('type') type?: string) {
    if (type === 'typeerror') {
      const obj: any = undefined;
      return obj.nonExistentMethod();
    }
    throw new InternalServerErrorException(
      'Simulated 500 Server Error: Triggered from Developer Diagnostics Console to verify logging pipeline.',
    );
  }

  /**
   * Clear or purge logs
   */
  @Delete()
  async clearLogs(
    @Query('olderThanDays') olderThanDays?: number,
    @Query('onlyErrors') onlyErrors?: string,
  ) {
    return this.devLogsService.clearLogs({
      olderThanDays: olderThanDays ? Number(olderThanDays) : undefined,
      onlyErrors: onlyErrors === 'true',
    });
  }
}

import { Module } from '@nestjs/common';
import { DevLogsService } from './dev-logs.service';
import { DevLogsController } from './dev-logs.controller';

@Module({
  controllers: [DevLogsController],
  providers: [DevLogsService],
  exports: [DevLogsService],
})
export class DevLogsModule {}

import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module';
import { WorkerProcessors } from './worker-processors';

@Module({
  imports: [CoreModule],
  providers: [WorkerProcessors],
})
export class WorkerModule {}

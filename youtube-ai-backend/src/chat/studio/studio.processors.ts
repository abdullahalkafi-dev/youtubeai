import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { StudioService } from './studio.service';

@Processor('content-stages')
export class StudioStageProcessor {
  constructor(private studio: StudioService) {}
  @Process({ name: 'execute', concurrency: 2 })
  execute(job: Job<{ id: string }>) {
    return this.studio.execute(job.data.id);
  }
}
@Processor('content-images')
export class StudioImageProcessor {
  constructor(private studio: StudioService) {}
  @Process({ name: 'execute', concurrency: 2 })
  execute(job: Job<{ id: string }>) {
    return this.studio.withImageSlot(() =>
      this.studio.executeImage(job.data.id),
    );
  }
}

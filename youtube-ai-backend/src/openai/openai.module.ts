import { Module } from '@nestjs/common';
import { OpenAIService } from './openai.service';
import { ThumbnailComposerService } from './thumbnail-composer.service';
import { SubjectReferenceService } from './subject-reference.service';
import { MinioModule } from '../minio/minio.module';
import { OpenAIStatusController } from './openai-status.controller';

@Module({
  imports: [MinioModule],
  controllers: [OpenAIStatusController],
  providers: [OpenAIService, ThumbnailComposerService, SubjectReferenceService],
  exports: [OpenAIService, ThumbnailComposerService, SubjectReferenceService],
})
export class OpenAIModule {}


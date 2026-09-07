import { Module } from '@nestjs/common';
import { OpenAIService } from './openai.service';
import { ThumbnailComposerService } from './thumbnail-composer.service';
import { SubjectReferenceService } from './subject-reference.service';
import { MinioModule } from '../minio/minio.module';

@Module({
  imports: [MinioModule],
  providers: [OpenAIService, ThumbnailComposerService, SubjectReferenceService],
  exports: [OpenAIService, ThumbnailComposerService, SubjectReferenceService],
})
export class OpenAIModule {}


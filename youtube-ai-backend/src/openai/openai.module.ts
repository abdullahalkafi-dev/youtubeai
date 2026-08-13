import { Module } from '@nestjs/common';
import { OpenAIService } from './openai.service';
import { ThumbnailComposerService } from './thumbnail-composer.service';
import { MinioModule } from '../minio/minio.module';

@Module({
  imports: [MinioModule],
  providers: [OpenAIService, ThumbnailComposerService],
  exports: [OpenAIService, ThumbnailComposerService],
})
export class OpenAIModule {}


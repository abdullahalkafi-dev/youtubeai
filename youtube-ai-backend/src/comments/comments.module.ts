import { Module } from '@nestjs/common';
import { CommentsService } from './comments.service';
import { CommentCacheService } from './comment-cache.service';
import { CommentsController } from './comments.controller';
import { YouTubeModule } from '../youtube/youtube.module';
import { QuotaModule } from '../quota/quota.module';
import { OpenAIModule } from '../openai/openai.module';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [YouTubeModule, QuotaModule, OpenAIModule, CommonModule],
  controllers: [CommentsController],
  providers: [CommentsService, CommentCacheService],
  exports: [CommentsService],
})
export class CommentsModule {}

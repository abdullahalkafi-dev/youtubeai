import { IsOptional, IsNumber, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class RunBatchDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  batchSize?: number = 50;

  @IsOptional()
  @IsIn(['auto_cron_batch', 'manual_ui_batch'])
  source?: string = 'manual_ui_batch';
}

export class BatchQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  @IsOptional()
  @IsIn(['video_seo', 'comment_reply'])
  type?: string = 'video_seo';
}

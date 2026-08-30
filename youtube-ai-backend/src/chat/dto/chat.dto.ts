import { IsString, IsOptional, IsIn, MaxLength, MinLength } from 'class-validator';

export class CreateThreadDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsIn(['video', 'standalone'])
  type: 'video' | 'standalone';

  @IsOptional()
  @IsString()
  videoId?: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  content: string;

  @IsOptional()
  @IsString()
  skill?: string;
}

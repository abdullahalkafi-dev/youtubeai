import { IsString, IsOptional, IsEnum, MaxLength, MinLength } from 'class-validator';

export class CreateThreadDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsEnum(['video', 'standalone'] as const)
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

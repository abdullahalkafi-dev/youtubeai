import {
  IsString,
  IsOptional,
  IsIn,
  MaxLength,
  MinLength,
} from 'class-validator';

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
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientRequestId?: string;
  @IsOptional()
  @IsString()
  @MaxLength(24)
  episodeId?: string;
  @IsOptional()
  @IsString()
  @MaxLength(24)
  targetArtifactId?: string;
  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  content: string;

  @IsOptional()
  @IsString()
  skill?: string;
}

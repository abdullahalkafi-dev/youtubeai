import { IsString, IsOptional } from 'class-validator';

export class CreateChannelDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  handle?: string;

  @IsOptional()
  @IsString()
  youtubeChannelId?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateSeoSettingsDto {
  dailyUpdateCap?: number;
  cronInterval?: number;
  autoPauseAtLimit?: boolean;
  autoResumeAtMidnight?: boolean;
}

export class UpdateApiKeysDto {
  openaiApiKey?: string;
  youtubeApiKey?: string;
}

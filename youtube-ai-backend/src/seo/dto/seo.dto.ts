import { IsString, IsOptional, MaxLength } from 'class-validator';

export class GenerateSeoDto {
  @IsString()
  videoId: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  customInstructions?: string;
}

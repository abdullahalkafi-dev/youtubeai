import { IsString, IsNotEmpty, IsOptional, IsArray, IsEnum, IsNumber, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateScriptDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsArray()
  @IsOptional()
  blocks?: any[];

  @IsString()
  @IsOptional()
  threadId?: string;

  @IsString()
  @IsOptional()
  messageId?: string;

  @IsString()
  @IsOptional()
  videoId?: string;

  @IsNumber()
  @IsOptional()
  wordCount?: number;

  @IsNumber()
  @IsOptional()
  estimatedDurationMinutes?: number;

  @IsArray()
  @IsOptional()
  tags?: string[];

  @IsEnum(['ai_chat', 'manual_import', 'ai_beautified'])
  @IsOptional()
  source?: string;

  @IsEnum(['teleprompter_beat', 'standard_markdown', 'raw_text'])
  @IsOptional()
  formatType?: string;
}

export class SaveScriptDto {
  @IsNumber()
  expectedVersion: number;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsArray()
  @IsOptional()
  blocks?: any[];

  @IsNumber()
  @IsOptional()
  wordCount?: number;

  @IsNumber()
  @IsOptional()
  estimatedDurationMinutes?: number;

  @IsArray()
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  changeDescription?: string;
}

export class ScriptQueryDto {
  @IsString()
  @IsOptional()
  q?: string;

  @IsString()
  @IsOptional()
  source?: string;

  @IsString()
  @IsOptional()
  timeFilter?: 'all' | 'today' | 'week' | 'month';

  @IsString()
  @IsOptional()
  sortBy?: 'recent' | 'duration' | 'title';

  @IsString()
  @IsOptional()
  favoriteOnly?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  limit?: number;
}

export class BeautifyScriptDto {
  @IsString()
  @IsNotEmpty()
  rawText: string;

  @IsString()
  @IsOptional()
  title?: string;
}

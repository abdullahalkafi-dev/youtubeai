import { IsString, IsEmail, IsOptional } from 'class-validator';

export class AuthResponseDto {
  @IsString()
  access_token: string;

  @IsString()
  id: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}

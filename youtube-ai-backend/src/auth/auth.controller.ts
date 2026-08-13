import {
  Controller,
  Get,
  Post,
  UseGuards,
  Req,
  Res,
  Body,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RegisterDto } from './dto/register.dto';

interface GoogleOAuthRequest extends Request {
  user: {
    googleId: string;
    email: string;
    name: string;
    avatar?: string;
    accessToken: string;
    refreshToken: string;
  };
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  /** POST /auth/register — Create new user with email/password */
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /** POST /auth/login — Login with email/password */
  @UseGuards(LocalAuthGuard)
  @Post('login')
  login(@Req() req: Request) {
    return this.authService.login(
      req.user as { id: string; email: string; name?: string; avatar?: string },
    );
  }

  /** GET /auth/google — Initiate Google OAuth flow */
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  async googleAuth() {
    // Guard handles redirect to Google
  }

  /** GET /auth/google/callback — Google OAuth callback */
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleAuthCallback(
    @Req() req: GoogleOAuthRequest,
    @Res() res: Response,
  ) {
    const result = await this.authService.handleGoogleLogin(req.user);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth/callback?token=${result.access_token}`);
  }

  /** GET /auth/profile — Get current user (requires JWT) */
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  getProfile(
    @CurrentUser()
    user: {
      id: string;
      email: string;
      name?: string;
      avatar?: string;
    },
  ) {
    return user;
  }

  /** POST /auth/logout — Clear session */
  @Post('logout')
  logout(@Res() res: Response) {
    res.json({ message: 'Logged out successfully' });
  }
}

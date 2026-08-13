import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Google OAuth Guard. Initiates the Google OAuth flow.
 * Use @UseGuards(GoogleAuthGuard) on the /auth/google route.
 */
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {}

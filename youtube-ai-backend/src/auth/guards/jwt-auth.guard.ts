import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT Authentication Guard. Protects routes that require a valid JWT token.
 * Apply to controllers or specific routes with @UseGuards(JwtAuthGuard).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

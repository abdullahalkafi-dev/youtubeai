import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Local Strategy for email/password authentication.
 * Used by POST /auth/login endpoint.
 */
@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly authService: AuthService) {
    super({ usernameField: 'email' });
  }

  async validate(
    email: string,
    password: string,
  ): Promise<{ id: string; email: string; name?: string; avatar?: string }> {
    const user = await this.authService.validateUserCredentials(
      email,
      password,
    );
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return user;
  }
}

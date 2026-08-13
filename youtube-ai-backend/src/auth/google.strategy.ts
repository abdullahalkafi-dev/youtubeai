import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

interface GoogleProfile {
  id: string;
  emails: Array<{ value: string }>;
  displayName: string;
  photos: Array<{ value: string }>;
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService) {
    super({
      clientID: configService.get<string>('GOOGLE_CLIENT_ID') || '',
      clientSecret: configService.get<string>('GOOGLE_CLIENT_SECRET') || '',
      callbackURL:
        configService.get<string>('GOOGLE_CALLBACK_URL') ||
        'http://localhost:3001/auth/google/callback',
      scope: [
        'email',
        'profile',
        'https://www.googleapis.com/auth/youtube.force-ssl',
        'https://www.googleapis.com/auth/yt-analytics.readonly',
        'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
      ],
    });
  }

  /**
   * Inject access_type: 'offline' to get a refresh_token from Google.
   * Without this, Google only issues a short-lived access_token.
   */
  authorizationParams(): Record<string, string> {
    return {
      access_type: 'offline',
      prompt: 'consent',
    };
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback,
  ): void {
    const { id, emails, displayName, photos } = profile;
    const user = {
      googleId: id,
      email: emails[0].value,
      name: displayName,
      avatar: photos[0]?.value,
      accessToken: _accessToken,
      refreshToken: _refreshToken,
    };
    done(null, user);
  }
}

import { Controller, Delete, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { MetaService } from './meta.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';

@Controller('auth/meta')
export class MetaController {
  constructor(
    private readonly metaService: MetaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * GET /auth/meta/start — returns { url }. A browser navigation cannot send the JWT header,
   * so the frontend calls this with its token and then sends the browser to `url`.
   */
  @Get('start')
  @UseGuards(JwtAuthGuard)
  start(@CurrentUser('id') userId: string) {
    return { url: this.metaService.buildAuthUrl(userId) };
  }

  /** GET /auth/meta/callback — Meta redirects the browser here. Public; the signed state identifies the user. */
  @Get('callback')
  @SkipTransform()
  async callback(
    @Query() query: { code?: string; state?: string; error?: string; error_reason?: string },
    @Res() res: Response,
  ) {
    const result = await this.metaService.handleCallback(query);
    const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const target = result.ok
      ? `${frontendUrl}/settings?meta=connected&pages=${result.pages}`
      : `${frontendUrl}/settings?meta=error&reason=${result.reason}`;
    res.redirect(target);
  }

  /** GET /auth/meta/accounts — connected Pages and Instagram accounts (no tokens). */
  @Get('accounts')
  @UseGuards(JwtAuthGuard)
  accounts(@CurrentUser('id') userId: string) {
    return this.metaService.listAccounts(userId);
  }

  /** DELETE /auth/meta/disconnect — delete stored Meta tokens and data. */
  @Delete('disconnect')
  @UseGuards(JwtAuthGuard)
  disconnect(@CurrentUser('id') userId: string) {
    return this.metaService.disconnect(userId);
  }
}

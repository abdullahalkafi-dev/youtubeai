import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { getOpenAiCreditsStatus } from '../common/errors/openai-credits';

@Controller('openai')
@UseGuards(JwtAuthGuard)
export class OpenAIStatusController {
  /** Dashboard banner: is the OpenAI account currently out of credits? */
  @Get('status')
  getStatus() {
    return getOpenAiCreditsStatus();
  }
}

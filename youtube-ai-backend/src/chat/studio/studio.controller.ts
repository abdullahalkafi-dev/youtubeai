import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Query,
  Sse,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import { StudioService } from './studio.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../../common/guards/channel-ownership.guard';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';

@Controller()
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class StudioController {
  constructor(private readonly studio: StudioService) {}
  @Get('channels/:channelId/creative-preferences')
  preferences(@Param('channelId') channel: string) {
    return this.studio.getPreferences(channel);
  }
  @Patch('channels/:channelId/creative-preferences')
  update(@Param('channelId') channel: string, @Body() body: unknown) {
    return this.studio.updatePreferences(channel, body);
  }
  @Post('channels/:channelId/creative-preferences/references')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  reference(
    @Param('channelId') channel: string,
    @UploadedFile() file: any,
    @Body() body: { role?: string; note?: string; name?: string },
  ) {
    return this.studio.addReference(channel, file, body);
  }
  @Get('threads/:id/runs')
  list(@Param('id') id: string) {
    return this.studio.list(id);
  }
  @Get('threads/:id/runs/:runId')
  snapshot(@Param('id') id: string, @Param('runId') run: string) {
    return this.studio.snapshot(id, run);
  }
  @Post('threads/:id/runs/:runId/cancel')
  cancel(@Param('id') id: string, @Param('runId') run: string) {
    return this.studio.cancel(id, run);
  }
  @Get('threads/:id/artifacts/:artifactId/versions')
  versions(@Param('id') id: string, @Param('artifactId') artifact: string) {
    return this.studio.versions(id, artifact);
  }
  @Post('threads/:id/artifacts/:artifactId/retry')
  retry(
    @Param('id') id: string,
    @Param('artifactId') artifact: string,
    @Body() body: unknown,
  ) {
    return this.studio.retry(id, artifact, body);
  }
  @Post('threads/:id/artifacts/:artifactId/revisions')
  revise(
    @Param('id') id: string,
    @Param('artifactId') artifact: string,
    @Body() body: unknown,
  ) {
    return this.studio.revision(id, artifact, body);
  }
  @SkipTransform()
  @Sse('threads/:id/runs/:runId/events')
  events(
    @Param('id') id: string,
    @Param('runId') run: string,
    @Query('after') after = '0',
  ) {
    return new Observable((subscriber) => {
      let stopped = false;
      void (async () => {
        let sequence = Math.max(0, Number(after) || 0);
        while (!stopped) {
          const snapshot = await this.studio.snapshot(id, run);
          const events: any[] = await this.studio.eventList(id, run, sequence);
          for (const event of events) {
            sequence = event.sequence;
            if (!stopped)
              subscriber.next({
                id: String(sequence),
                data: {
                  runId: run,
                  sequence,
                  type: event.type,
                  timestamp: event.createdAt,
                  payload: event.payload,
                },
              });
          }
          if (
            [
              'completed',
              'completed_with_issues',
              'failed',
              'cancelled',
              'waiting_for_input',
            ].includes(snapshot.status)
          ) {
            subscriber.complete();
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      })().catch((error) => subscriber.error(error));
      return () => {
        stopped = true;
      };
    });
  }
}

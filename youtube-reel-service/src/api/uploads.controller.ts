import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthedRequest, ReelAuthGuard } from './auth.guard';
import { FinishUploadDto, LinkVideoDto, parse, StartUploadDto } from './dto';
import { ReelsApiService } from './reels-api.service';
import { UploadsService } from './uploads.service';

/** Raw video uploads ("From my new video") and linking the result to its published YouTube video. */
@Controller('channels/:channelId')
@UseGuards(ReelAuthGuard)
export class UploadsController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly api: ReelsApiService,
  ) {}

  @Post('uploads')
  start(@Param('channelId') channelId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.uploads.start(channelId, req.user!.id, parse(StartUploadDto, body));
  }

  @Get('uploads/:uploadId')
  async get(@Param('channelId') channelId: string, @Param('uploadId') uploadId: string) {
    return this.uploads.out(await this.uploads.load(channelId, uploadId));
  }

  /** Raw bytes of one part (Content-Type: application/octet-stream). */
  @Put('uploads/:uploadId/parts/:n')
  part(@Param('channelId') channelId: string, @Param('uploadId') uploadId: string, @Param('n') n: string, @Req() req: Request) {
    return this.uploads.writePart(channelId, uploadId, Number(n), req);
  }

  @Post('uploads/:uploadId/complete')
  complete(@Param('channelId') channelId: string, @Param('uploadId') uploadId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    return this.api.createVideoCampaign(channelId, req.user!.id, uploadId, parse(FinishUploadDto, body));
  }

  @Delete('uploads/:uploadId')
  cancel(@Param('channelId') channelId: string, @Param('uploadId') uploadId: string) {
    return this.uploads.cancel(channelId, uploadId);
  }

  @Get('campaigns/:campaignId/link-candidates')
  candidates(@Param('channelId') channelId: string, @Param('campaignId') campaignId: string) {
    return this.api.linkCandidates(channelId, campaignId);
  }

  @Post('campaigns/:campaignId/link-video')
  link(@Param('channelId') channelId: string, @Param('campaignId') campaignId: string, @Body() body: unknown) {
    return this.api.linkVideo(channelId, campaignId, parse(LinkVideoDto, body).youtubeId);
  }
}

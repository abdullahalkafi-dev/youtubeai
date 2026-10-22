import { StudioService } from './studio/studio.service';
import { StudioRouter } from './studio/studio-router';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  Sse,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChannelOwnershipGuard } from '../common/guards/channel-ownership.guard';
import { CreateThreadDto, SendMessageDto } from './dto/chat.dto';
import { Observable, Subscriber } from 'rxjs';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';

const ALLOWED_UPLOAD_MIMES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

@Controller()
@UseGuards(JwtAuthGuard, ChannelOwnershipGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly studio: StudioService,
    private readonly studioRouter: StudioRouter,
  ) {}

  @Post('channels/:channelId/threads')
  createThread(
    @Param('channelId') channelId: string,
    @Body() dto: CreateThreadDto,
  ) {
    return this.chatService.createThread(channelId, dto);
  }

  @Get('channels/:channelId/threads')
  findAll(
    @Param('channelId') channelId: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.chatService.findAll(channelId, includeArchived === 'true');
  }

  @Get('channels/:channelId/threads/video/:videoId')
  findByVideoId(
    @Param('channelId') channelId: string,
    @Param('videoId') videoId: string,
  ) {
    return this.chatService.findByVideoId(channelId, videoId);
  }

  @Get('threads/:id')
  findOne(@Param('id') id: string) {
    return this.chatService.findById(id);
  }

  @Post('threads/:id/messages')
  async sendMessage(@Param('id') id: string, @Body() dto: SendMessageDto) {
    if (await this.studioRouter.useStudio(id, dto))
      return this.studio.submit(id, dto);
    return this.chatService.sendMessage(id, dto);
  }

  @SkipTransform()
  @Post('threads/:id/messages/stream')
  @Sse('threads/:id/messages/stream')
  streamMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
  ): Observable<any> {
    return new Observable((subscriber: Subscriber<any>) => {
      let isAborted = false;
      (async () => {
        try {
          const generator = (await this.studioRouter.useStudio(id, dto))
            ? this.studio.stream(id, dto)
            : this.chatService.streamMessage(id, dto);
          for await (const chunk of generator) {
            if (isAborted) break;
            if (!isAborted) {
              subscriber.next({ data: chunk });
            }
          }
          if (!isAborted) subscriber.complete();
        } catch (error) {
          if (!isAborted) subscriber.error(error);
        }
      })();

      return () => {
        isAborted = true;
      };
    });
  }

  @Post('threads/:id/upload-asset')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 15 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (ALLOWED_UPLOAD_MIMES.includes(file.mimetype)) cb(null, true);
        else
          cb(
            new BadRequestException(
              `File type "${file.mimetype}" not allowed.`,
            ),
            false,
          );
      },
    }),
  )
  async uploadAssetOnly(
    @Param('id') threadId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.chatService.uploadAssetOnly(threadId, file);
  }

  @Post('threads/:id/messages/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (ALLOWED_UPLOAD_MIMES.includes(file.mimetype)) cb(null, true);
        else
          cb(
            new BadRequestException(
              `File type "${file.mimetype}" not allowed. Accepted: PDF, JPEG, PNG, WebP`,
            ),
            false,
          );
      },
    }),
  )
  async uploadAndChat(
    @Param('id') threadId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('content') content?: string,
    @Body('clientRequestId') clientRequestId?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (await this.studio.enabled(threadId)) {
      const asset = await this.chatService.uploadAssetOnly(threadId, file);
      let extractedText = '';
      if (file.mimetype === 'application/pdf') {
        const parser = require('pdf-parse');
        extractedText = String((await parser(file.buffer)).text || '').slice(
          0,
          30000,
        );
      } else if (!file.mimetype.startsWith('image/'))
        extractedText = file.buffer.toString('utf8').slice(0, 30000);
      return this.studio.submit(threadId, {
        content:
          (content || 'Review this attachment') +
          (extractedText ? '\n\n[ATTACHMENT CONTENT]\n' + extractedText : ''),
        clientRequestId,
        attachments: [
          {
            type: file.mimetype.startsWith('image/') ? 'image' : 'pdf',
            url: asset.url,
            filename: asset.filename,
            extractedText,
          },
        ],
      });
    }
    return this.chatService.handleFileUpload(threadId, file, content);
  }

  @Patch('threads/:id')
  renameThread(@Param('id') id: string, @Body() body: { title: string }) {
    return this.chatService.renameThread(id, body.title);
  }

  @Post('threads/:id/archive')
  archive(@Param('id') id: string) {
    return this.chatService.archiveManual(id);
  }

  @Delete('threads/:id')
  remove(@Param('id') id: string) {
    return this.chatService.remove(id);
  }

  @Delete('threads/:id/messages/:messageId')
  deleteMessage(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.chatService.deleteMessage(id, messageId);
  }

  @Post('threads/:id/generate-thumbnail-image')
  generateThumbnailImage(
    @Param('id') id: string,
    @Body()
    body: {
      text: string;
      visual: string;
      colors: string;
      conceptTitle?: string;
      videoTitle?: string;
      selectedHostImage?: string;
      logoPosition?: 'top-left' | 'top-right' | 'none';
      customLayoutInstructions?: string;
      messageId?: string;
      aspectRatio?: '16:9' | '9:16';
      excludeHost?: boolean;
      excludeLogo?: boolean;
      referenceImageUrls?: string[];
      customHostUrl?: string;
      customHostImage?: string;
      auto?: boolean;
      omitPeople?: string[];
    },
  ) {
    return this.chatService.generateThumbnailImage(id, body);
  }

  @Post('threads/:id/generate-scene-image')
  generateSceneImage(
    @Param('id') id: string,
    @Body()
    body: {
      scene: string;
      style: string;
      colors: string;
      textOverlay?: string;
      videoTitle?: string;
      referenceImageUrl?: string;
      logoPosition?: 'top-right' | 'none';
      messageId?: string;
    },
  ) {
    return this.chatService.generateSceneImage(id, body);
  }

  @Post('threads/:id/edit-image')
  async editImage(
    @Param('id') id: string,
    @Body()
    body: {
      prompt: string;
      baseImageUrl: string;
      sourceImageUrl?: string;
      referenceImageUrls?: string[];
      mode?: 'thumbnail' | 'scene';
      selectedHostImage?: string;
      aspectRatio?: '16:9' | '9:16';
      excludeHost?: boolean;
      excludeLogo?: boolean;
      logoPosition?: 'top-left' | 'top-right' | 'none';
      customHostUrl?: string;
      customHostImage?: string;
      textOverlay?: string;
      visualDescription?: string;
    },
  ) {
    if (await this.studio.enabled(id)) {
      const revision = await this.studio.reviseImageByUrl(id, body);
      if (revision) return revision;
    }
    return this.chatService.editImage(id, body);
  }

  @Post('threads/:id/generate-image-direct')
  async generateImageDirect(
    @Param('id') id: string,
    @Body()
    body: {
      prompt: string;
      videoTitle?: string;
      logoPosition?: 'top-right' | 'none';
    },
  ) {
    if (await this.studio.enabled(id))
      return this.studio.submit(id, {
        content: body.prompt,
        skill: 'image',
        clientRequestId: (body as any).clientRequestId,
      });
    return this.chatService.generateImageDirect(id, body);
  }

  @Post('threads/:id/recompose-overlay')
  recomposeOverlay(
    @Param('id') id: string,
    @Body()
    body: {
      baseImageUrl: string;
      selectedHostImage?: string;
      customHostUrl?: string;
      excludeHost?: boolean;
      logoPosition?: 'top-right' | 'none';
      excludeLogo?: boolean;
      aspectRatio?: '16:9' | '9:16';
    },
  ) {
    return this.chatService.recomposeThumbnailOverlay(id, body);
  }

  @Post('threads/:id/suggest-subjects')
  suggestSubjects(
    @Param('id') id: string,
    @Body()
    body: {
      videoTitle?: string;
      visualConcept?: string;
    },
  ) {
    return this.chatService.suggestSubjects(id, body);
  }

  @Post('threads/:id/search-subject-image')
  searchSubjectImage(
    @Param('id') id: string,
    @Body()
    body: {
      query: string;
    },
  ) {
    return this.chatService.searchSubjectImage(body.query);
  }

  @Post('threads/:id/preview-cutout')
  previewCutout(
    @Param('id') id: string,
    @Body()
    body: {
      imageBase64: string;
      mode?: 'green_screen' | 'ai';
      tolerance?: number;
      smoothness?: number;
    },
  ) {
    return this.chatService.previewCutout(id, body);
  }

  @Post('threads/:id/save-custom-host')
  saveCustomHost(
    @Param('id') id: string,
    @Body()
    body: {
      imageBase64: string;
      filename?: string;
    },
  ) {
    return this.chatService.saveCustomHost(id, body);
  }

  @Delete('threads/:id/custom-host')
  deleteCustomHost(
    @Param('id') id: string,
    @Body()
    body: {
      filename: string;
    },
  ) {
    return this.chatService.deleteCustomHost(id, body.filename);
  }
}

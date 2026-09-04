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
  constructor(private readonly chatService: ChatService) {}

  @Post('channels/:channelId/threads')
  createThread(@Param('channelId') channelId: string, @Body() dto: CreateThreadDto) {
    return this.chatService.createThread(channelId, dto);
  }

  @Get('channels/:channelId/threads')
  findAll(@Param('channelId') channelId: string, @Query('includeArchived') includeArchived?: string) {
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
  sendMessage(@Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.chatService.sendMessage(id, dto);
  }

  @SkipTransform()
  @Post('threads/:id/messages/stream')
  @Sse('threads/:id/messages/stream')
  streamMessage(@Param('id') id: string, @Body() dto: SendMessageDto): Observable<any> {
    return new Observable((subscriber: Subscriber<any>) => {
      let isAborted = false;
      (async () => {
        try {
          for await (const chunk of this.chatService.streamMessage(id, dto)) {
            if (isAborted) break;
            subscriber.next({ data: chunk });
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
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (ALLOWED_UPLOAD_MIMES.includes(file.mimetype)) cb(null, true);
      else cb(new BadRequestException(`File type "${file.mimetype}" not allowed.`), false);
    },
  }))
  async uploadAssetOnly(
    @Param('id') threadId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.chatService.uploadAssetOnly(threadId, file);
  }

  @Post('threads/:id/messages/upload')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (ALLOWED_UPLOAD_MIMES.includes(file.mimetype)) cb(null, true);
      else cb(new BadRequestException(`File type "${file.mimetype}" not allowed. Accepted: PDF, JPEG, PNG, WebP`), false);
    },
  }))
  async uploadAndChat(
    @Param('id') threadId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('content') content?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
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
      customHostUrl?: string;
      customHostImage?: string;
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
  editImage(
    @Param('id') id: string,
    @Body()
    body: {
      prompt: string;
      baseImageUrl: string;
      referenceImageUrls?: string[];
      mode?: 'thumbnail' | 'scene';
      selectedHostImage?: string;
      aspectRatio?: '16:9' | '9:16';
      excludeHost?: boolean;
      excludeLogo?: boolean;
      logoPosition?: 'top-left' | 'top-right' | 'none';
      customHostUrl?: string;
      customHostImage?: string;
    },
  ) {
    return this.chatService.editImage(id, body);
  }

  @Post('threads/:id/generate-image-direct')
  generateImageDirect(
    @Param('id') id: string,
    @Body() body: {
      prompt: string;
      videoTitle?: string;
      logoPosition?: 'top-right' | 'none';
    },
  ) {
    return this.chatService.generateImageDirect(id, body);
  }
}

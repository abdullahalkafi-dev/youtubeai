import { Injectable, NotFoundException, Logger, forwardRef, Inject, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import { Channel, ChannelDocument } from '../mongo/schemas/channel.schema';
import { Thread, ThreadDocument, Message } from '../mongo/schemas/thread.schema';
import { User, UserDocument } from '../mongo/schemas/user.schema';
import { Video, VideoDocument } from '../mongo/schemas/video.schema';
import { TrendingTopic, TrendingTopicDocument } from '../mongo/schemas/trending-topic.schema';
import { AIOutputLog, AIOutputLogDocument } from '../mongo/schemas/ai-output-log.schema';
import { OpenAIService, TokenUsage } from '../openai/openai.service';
import { ThumbnailComposerService } from '../openai/thumbnail-composer.service';
import { MinioService } from '../minio/minio.service';
import { ChromaService } from '../chroma/chroma.service';
import { SkillRegistry } from './skills/skill-registry';
import { CreateThreadDto, SendMessageDto } from './dto/chat.dto';
import { leanDoc, leanDocs } from '../common/utils/lean';
import { TrendsService } from '../trends/trends.service';

const MAX_MESSAGES_BEFORE_SUMMARY = 30;
const THREAD_EXPIRY_DAYS = 7;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly modelName: string;

  constructor(
    @InjectModel(Thread.name) private readonly threadModel: Model<ThreadDocument>,
    @InjectModel(Channel.name) private readonly channelModel: Model<ChannelDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Video.name) private readonly videoModel: Model<VideoDocument>,
    @InjectModel(TrendingTopic.name) private readonly trendingTopicModel: Model<TrendingTopicDocument>,
    @InjectModel(AIOutputLog.name) private readonly aiOutputLogModel: Model<AIOutputLogDocument>,
    private readonly openaiService: OpenAIService,
    private readonly composerService: ThumbnailComposerService,
    private readonly minioService: MinioService,
    private readonly chromaService: ChromaService,
    private readonly skillRegistry: SkillRegistry,
    @Inject(forwardRef(() => TrendsService))
    private readonly trendsService: TrendsService,
    private readonly configService: ConfigService,
  ) {
    this.modelName = this.configService.get<string>('OPENAI_MODEL', 'gpt-5.6-terra');
  }

  async createThread(channelId: string, dto: CreateThreadDto) {
    let title = dto.title;
    let videoTitle: string | undefined;
    let videoThumbnail: string | undefined;

    // Auto-name from video title
    if (dto.type === 'video' && dto.videoId) {
      if (Types.ObjectId.isValid(dto.videoId)) {
        const video = await this.videoModel.findById(dto.videoId).lean();
        if (video) {
          videoTitle = video.youtubeTitle || video.title;
          videoThumbnail = video.thumbnailUrl || (video as any)?.thumbnails?.default?.url;
          if (!title) title = videoTitle?.slice(0, 50) || 'Video Thread';
        }
      }
    }

    // Default placeholder — will be auto-named after first message
    if (!title) {
      title = 'New Thread';
    }

    const thread = await this.threadModel.create({
      channelId: new Types.ObjectId(channelId),
      type: dto.type,
      title,
      videoId: dto.videoId,
      videoTitle: videoTitle || dto.title,
      videoThumbnail,
      status: 'active',
      messages: [],
    });
    return this.findById(thread._id.toString());
  }

  async findAll(channelId: string, includeArchived = false) {
    if (!Types.ObjectId.isValid(channelId)) {
      throw new NotFoundException(`Invalid channel ID: ${channelId}`);
    }
    const filter: any = { channelId: new Types.ObjectId(channelId) };
    if (!includeArchived) filter.status = 'active';
    const threads = await this.threadModel.find(filter).sort({ updatedAt: -1 }).lean();
    return leanDocs(threads);
  }

  async findByVideoId(channelId: string, videoId: string) {
    const thread = await this.threadModel.findOne({
      channelId: new Types.ObjectId(channelId),
      videoId: videoId,
      status: 'active',
    }).lean();
    return thread ? leanDoc(thread) : null;
  }

  async findById(id: string) {
    const thread = await this.threadModel.findById(new Types.ObjectId(id)).lean();
    if (!thread) throw new NotFoundException(`Thread ${id} not found`);
    return leanDoc(thread);
  }

  async renameThread(id: string, title: string) {
    const updated = await this.threadModel.findByIdAndUpdate(new Types.ObjectId(id), { $set: { title } }, { new: true }).lean();
    if (!updated) throw new NotFoundException(`Thread ${id} not found`);
    return leanDoc(updated);
  }

  /**
   * Auto-name a thread from the first user message.
   * Only runs if title is still the default "New Thread" pattern.
   * Uses fast model with generous token limit, with an intelligent heuristic fallback.
   */
  async autoNameThread(threadId: string, firstUserMessage: string): Promise<string | void> {
    try {
      const thread = await this.threadModel.findById(threadId);
      if (!thread || (thread.title && thread.title !== 'New Thread')) return;

      // Direct extraction if message contains active script context
      const scriptMatch = firstUserMessage.match(/\[ACTIVE SCRIPT CONTEXT:\s*"([^"]+)"\]/i);
      if (scriptMatch && scriptMatch[1]) {
        const cleanTitle = `Script: ${scriptMatch[1].trim().slice(0, 45)}`;
        await this.threadModel.findByIdAndUpdate(threadId, { $set: { title: cleanTitle } });
        this.logger.log(`Auto-named script thread ${threadId}: "${cleanTitle}"`);
        return cleanTitle;
      }

      let cleanTitle = '';
      try {
        const generatedTitle = await this.openaiService.chatFast({
          systemPrompt: 'Generate a concise, descriptive thread title (3 to 6 words maximum) for this user request. Return ONLY the plain text title, nothing else. No quotes, no markdown, no punctuation at the end.',
          userMessage: firstUserMessage,
          temperature: 0.3,
          maxCompletionTokens: 150,
        });

        cleanTitle = (generatedTitle || '')
          .replace(/^["'#*`]+|["'#*`]+$/g, '')
          .replace(/[\r\n]+/g, ' ')
          .trim()
          .slice(0, 50);
      } catch (err: any) {
        this.logger.warn(`OpenAI auto-name failed for thread ${threadId}: ${err.message}`);
      }

      // Intelligent fallback if OpenAI call returns empty or fails
      if (!cleanTitle || cleanTitle.length < 2) {
        const words = (firstUserMessage || '')
          .replace(/[\r\n]+/g, ' ')
          .replace(/[#*`_~[\]()]/g, '')
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 6);
        cleanTitle = words.join(' ').slice(0, 45);
      }

      if (cleanTitle && cleanTitle.length > 0) {
        await this.threadModel.findByIdAndUpdate(threadId, { $set: { title: cleanTitle } });
        this.logger.log(`Auto-named thread ${threadId}: "${cleanTitle}"`);
        return cleanTitle;
      }
    } catch (error) {
      this.logger.warn(`Auto-name failed for thread ${threadId}: ${error.message}`);
    }
  }

  async sendMessage(threadId: string, dto: SendMessageDto) {
    const thread = await this.threadModel.findById(threadId);
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);

    const health = await this.checkThreadHealth(thread);
    if (!health.ok) throw new BadRequestException(health.error);

    // Auto-name from first user message (background, non-blocking)
    this.handleFirstMessage(threadId, thread, dto.content);

    // Save user message atomically — persists even if OpenAI call fails
    const userMsg = { role: 'user' as const, content: dto.content, createdAt: new Date() };
    await this.threadModel.findByIdAndUpdate(threadId, { $push: { messages: userMsg } });

    // Re-load thread to get the updated messages array (includes the user message we just saved)
    const updatedThread = await this.threadModel.findById(threadId);
    if (!updatedThread) throw new NotFoundException(`Thread ${threadId} not found`);

    // Extract actual user prompt if prepended with injected active script context
    const cleanUserPrompt = dto.content.replace(/^\[ACTIVE SCRIPT CONTEXT:[\s\S]*?\[USER REQUEST\]\s*/i, '').trim();

    // Find previous assistant message for dynamic A/B/C/D menu option resolution
    const prevAssistantMsg = updatedThread.messages
      .slice(0, -1)
      .reverse()
      .find(m => m.role === 'assistant')?.content;

    // Resolve skill: auto-classify intent on clean prompt
    const detectedIntent = this.skillRegistry.classifyIntent(cleanUserPrompt || dto.content, prevAssistantMsg);

    // Bidirectional override: if user clearly asks for a specific skill (non-general), override sticky tab
    const resolvedSkill = (detectedIntent && detectedIntent !== 'general' && (!dto.skill || dto.skill === 'general' || detectedIntent !== dto.skill))
      ? detectedIntent
      : (dto.skill || detectedIntent || 'general');

    // Get channel and skill
    const channel = await this.channelModel.findById(updatedThread.channelId).lean();
    const skill = this.skillRegistry.get(resolvedSkill);

    // Auto-load context based on skill
    const skillContext = await skill.loadContext(updatedThread.channelId.toString(), updatedThread.videoId || undefined);

    // RAG context
    const ragContext = await this.buildRagContext(dto.content, resolvedSkill);

    // Build conversation history (last N messages)
    const allMessages = updatedThread.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    let contextMessages = allMessages;
    let summaryToPrepend = updatedThread.summary;

    if (allMessages.length > MAX_MESSAGES_BEFORE_SUMMARY) {
      if (!summaryToPrepend) {
        const summaryResult = await this.summarizeAndCompress(threadId.toString(), allMessages.slice(0, -5), channel || undefined);
        summaryToPrepend = summaryResult.summary;
        await this.threadModel.findByIdAndUpdate(threadId, { $set: { summary: summaryToPrepend } });
      }
      contextMessages = [
        { role: 'user' as const, content: `[Previous conversation summary]\n${summaryToPrepend}` },
        ...allMessages.slice(-5),
      ];
    }

    // Build STATIC system prompt (byte-identical across requests for caching)
    const systemPrompt = skill.buildSystemPrompt(channel || {}, skillContext);

    // Build DYNAMIC context (goes in user message prefix, NOT system prompt)
    let dynamicContext = this.skillRegistry.buildDynamicContext(channel || {}, skillContext) + ragContext;

    // Detect if research is needed
    let needsResearch = this.detectNeedsResearch(dto.content, resolvedSkill);

    // Auto-lite refresh: if trends are stale/empty, refresh in background
    if (!this.areTrendsFresh(skillContext.trendingTopics)) {
      this.logger.log(`Thread ${threadId}: Stale trends, triggering lite refresh in background`);
      this.trendsService.refreshTrendsLite(updatedThread.channelId.toString())
        .then((freshTopics) => {
          if (freshTopics.length > 0) {
            this.logger.log(`Lite refresh completed: ${freshTopics.length} new topics for channel ${updatedThread.channelId}`);
          }
        })
        .catch((error) => {
          this.logger.warn(`Lite trends refresh failed: ${error.message}`);
        });
    }

    let aiResponse: { content: string; usage?: TokenUsage };
    let sources: any[] = [];

    if (needsResearch) {
      this.logger.log(`Thread ${threadId}: Research detected, using web search`);
      const searchResult = await this.openaiService.chatWithSearch({
        userMessage: dto.content,
        systemPrompt: systemPrompt + '\n\n' + dynamicContext,
        conversationHistory: contextMessages.slice(0, -1),
      });
      aiResponse = { content: searchResult.content, usage: searchResult.usage };
      sources = searchResult.sources;
    } else {
      aiResponse = await this.openaiService.chat({
        messages: [{ role: 'user', content: dto.content }],
        channel: channel || undefined,
        conversationHistory: contextMessages.slice(0, -1),
        threadId: threadId.toString(),
        systemPromptOverride: systemPrompt,
        dynamicContext,
        temperature: skill.getTemperature?.() ?? 0.7,
      });
    }

    // Save AI response atomically
    const assistantMessage: Message = {
      role: 'assistant',
      content: aiResponse.content,
      metadata: {
        category: resolvedSkill,
        ...(sources.length > 0 ? { sources } : {}),
      },
      createdAt: new Date(),
    } as any;

    await this.threadModel.findByIdAndUpdate(threadId, {
      $push: { messages: assistantMessage },
      $set: { updatedAt: new Date() },
      $inc: {
        totalPromptTokens: aiResponse.usage?.promptTokens || 0,
        totalCompletionTokens: aiResponse.usage?.completionTokens || 0,
        totalCachedTokens: aiResponse.usage?.cachedTokens || 0,
      },
    });

    // Store in ChromaDB
    try {
      await this.chromaService.upsert('chat_messages', `${threadId}_${updatedThread.messages.length + 1}`,
        `User: ${dto.content}\nAssistant: ${aiResponse.content}`,
        { threadId: threadId.toString(), channelId: updatedThread.channelId.toString(), category: resolvedSkill });
    } catch { /* RAG optional */ }

    // Log AI output
    await this.logAiOutput({
      channelId: updatedThread.channelId.toString(), operation: 'chat', threadId: threadId.toString(),
      inputSummary: dto.content.substring(0, 200), output: { content: aiResponse.content }, usage: aiResponse.usage,
    });

    return assistantMessage;
  }

  /**
   * Stream a message — returns an async generator that yields chunks.
   */
  async *streamMessage(threadId: string, dto: SendMessageDto): AsyncGenerator<{ type: string; content?: string; messageId?: string; usage?: TokenUsage; title?: string; category?: string }> {
    const thread = await this.threadModel.findById(threadId);
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);

    const health = await this.checkThreadHealth(thread);
    if (!health.ok) {
      yield { type: 'error', content: health.error };
      return;
    }

    // Auto-name from first user message (tracked promise)
    const autoNamePromise = this.handleFirstMessage(threadId, thread, dto.content);

    // Save user message atomically — persists even if stream drops
    const userMsg = { role: 'user' as const, content: dto.content, createdAt: new Date() };
    await this.threadModel.findByIdAndUpdate(threadId, { $push: { messages: userMsg } });

    // Re-load thread to get the updated messages array
    const updatedThread = await this.threadModel.findById(threadId);
    if (!updatedThread) {
      yield { type: 'error', content: 'Thread not found' };
      return;
    }

    // Extract actual user prompt if prepended with injected active script context
    const cleanUserPrompt = dto.content.replace(/^\[ACTIVE SCRIPT CONTEXT:[\s\S]*?\[USER REQUEST\]\s*/i, '').trim();

    const prevAssistantMsg = updatedThread.messages
      ?.slice(0, -1)
      ?.reverse()
      ?.find(m => m.role === 'assistant')?.content;

    // Resolve skill: auto-classify intent on clean prompt
    const detectedIntent = this.skillRegistry.classifyIntent(cleanUserPrompt || dto.content, prevAssistantMsg);

    // Bidirectional override: if user clearly asks for a specific skill (non-general), override sticky tab
    const resolvedSkill = (detectedIntent && detectedIntent !== 'general' && (!dto.skill || dto.skill === 'general' || detectedIntent !== dto.skill))
      ? detectedIntent
      : (dto.skill || detectedIntent || 'general');

    const channel = await this.channelModel.findById(updatedThread.channelId).lean();
    const skill = this.skillRegistry.get(resolvedSkill);
    const skillContext = await skill.loadContext(updatedThread.channelId.toString(), updatedThread.videoId || undefined);

    // RAG context
    const ragContext = await this.buildRagContext(dto.content, resolvedSkill);

    // Build STATIC system prompt (byte-identical across requests for caching)
    const systemPrompt = skill.buildSystemPrompt(channel || {}, skillContext);

    // Build DYNAMIC context (goes in user message prefix, NOT system prompt)
    let dynamicContext = this.skillRegistry.buildDynamicContext(channel || {}, skillContext) + ragContext;

    // Build conversation history (last N messages)
    const allMessages = updatedThread.messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    let contextMessages = allMessages;
    let summaryToPrepend = updatedThread.summary;

    if (allMessages.length > MAX_MESSAGES_BEFORE_SUMMARY) {
      if (!summaryToPrepend) {
        const summaryResult = await this.summarizeAndCompress(threadId.toString(), allMessages.slice(0, -5), channel || undefined);
        summaryToPrepend = summaryResult.summary;
        await this.threadModel.findByIdAndUpdate(threadId, { $set: { summary: summaryToPrepend } });
      }
      contextMessages = [
        { role: 'user' as const, content: `[Previous conversation summary]\n${summaryToPrepend}` },
        ...allMessages.slice(-5),
      ];
    }

    const conversationHistory = contextMessages.slice(0, -1);

    // Stream
    let fullContent = '';
    let finalUsage: TokenUsage | undefined;
    let sources: any[] = [];
    let savedThread: any = null;

    // Detect if research is needed
    let needsResearch = this.detectNeedsResearch(dto.content, resolvedSkill);

    // Auto-lite refresh: if trends are stale/empty, refresh in background
    if (!this.areTrendsFresh(skillContext.trendingTopics)) {
      this.logger.log(`Thread ${threadId}: Stale trends, triggering lite refresh in background`);
      this.trendsService.refreshTrendsLite(updatedThread.channelId.toString())
        .then(async (freshTopics) => {
          if (freshTopics.length > 0) {
            this.logger.log(`Lite refresh completed: ${freshTopics.length} new topics for channel ${updatedThread.channelId}`);
          }
        })
        .catch((error) => {
          this.logger.warn(`Lite trends refresh failed: ${error.message}`);
        });
    }

    try {
      if (needsResearch) {
        this.logger.log(`Thread ${threadId}: Research detected in stream, using web search`);
        try {
          for await (const chunk of this.openaiService.chatWithSearchStream({
            userMessage: dto.content,
            systemPrompt: systemPrompt + '\n\n' + dynamicContext,
            conversationHistory,
          })) {
            if (chunk.chunk) {
              fullContent += chunk.chunk;
              yield { type: 'chunk', content: chunk.chunk };
            }
            if (chunk.sources) sources = chunk.sources;
            if (chunk.usage) finalUsage = chunk.usage;
          }
        } catch (error) {
          this.logger.warn(`Stream research error for thread ${threadId}: ${error.message}`);
          yield { type: 'error', content: 'Stream interrupted. Please try again.' };
          return;
        }
      } else {
        try {
          for await (const chunk of this.openaiService.chatStream({
            messages: [{ role: 'user', content: dto.content }],
            channel: channel || undefined,
            conversationHistory,
            threadId: threadId.toString(),
            systemPromptOverride: systemPrompt,
            dynamicContext,
            temperature: skill.getTemperature?.() ?? 0.7,
          })) {
            if (chunk.chunk) {
              fullContent += chunk.chunk;
              yield { type: 'chunk', content: chunk.chunk };
            }
            if (chunk.usage) finalUsage = chunk.usage;
          }
        } catch (error) {
          this.logger.warn(`Stream error for thread ${threadId}: ${error.message}`);
          yield { type: 'error', content: 'Stream interrupted. Please try again.' };
          return;
        }
      }
    } finally {
      // Save response atomically — GUARANTEED to execute even on client abort/disconnect
      if (fullContent && fullContent.trim().length > 0) {
        try {
          const assistantMessage: Message = {
            role: 'assistant',
            content: fullContent,
            metadata: {
              category: resolvedSkill,
              ...(sources.length > 0 ? { sources } : {}),
            },
            createdAt: new Date(),
          } as any;

          const updateOps: any = {
            $push: { messages: assistantMessage },
            $set: { updatedAt: new Date() },
          };
          if (finalUsage) {
            updateOps.$inc = {
              totalPromptTokens: finalUsage.promptTokens || 0,
              totalCompletionTokens: finalUsage.completionTokens || 0,
              totalCachedTokens: finalUsage.cachedTokens || 0,
            };
          }

          // Ensure auto-naming has finished so savedThread reflects updated title
          try {
            await autoNamePromise;
          } catch { /* auto-naming optional */ }

          savedThread = await this.threadModel.findByIdAndUpdate(threadId, updateOps, { new: true });

          // Store in ChromaDB
          try {
            await this.chromaService.upsert('chat_messages', `${threadId}_${(updatedThread?.messages?.length || 0) + 1}`,
              `User: ${dto.content}\nAssistant: ${fullContent}`,
              { threadId: threadId.toString(), channelId: updatedThread.channelId.toString(), category: resolvedSkill });
          } catch { /* RAG optional */ }

          // Log AI output
          await this.logAiOutput({
            channelId: updatedThread.channelId.toString(), operation: 'chat_stream', threadId: threadId.toString(),
            inputSummary: dto.content.substring(0, 200), output: { content: fullContent }, usage: finalUsage,
          });
        } catch (saveError: any) {
          this.logger.error(`Failed to persist stream message to DB: ${saveError.message}`);
        }
      }
    }

    if (savedThread) {
      const lastMsgId = savedThread?.messages?.[savedThread.messages.length - 1]?._id?.toString();
      yield { type: 'done', messageId: lastMsgId, usage: finalUsage, title: savedThread.title, category: resolvedSkill };
    }
  }

  async archiveThread(id: string, reason: string) {
    await this.threadModel.findByIdAndUpdate(id, { $set: { status: 'archived' } });
    this.logger.log(`Thread ${id} archived: ${reason}`);
  }

  async archiveManual(id: string) {
    await this.findById(id);
    await this.archiveThread(id, 'manual');
    return { success: true, threadId: id };
  }

  async remove(id: string) {
    const thread = await this.findById(id);

    // Clean up ChromaDB vectors for this thread
    try {
      await this.chromaService.deleteByMetadata('chat_messages', { threadId: id });
    } catch (error) {
      this.logger.warn(`Failed to clean ChromaDB for thread ${id}: ${error.message}`);
    }

    const removed = await this.threadModel.findByIdAndDelete(new Types.ObjectId(id)).lean();
    return leanDoc(removed);
  }

  async deleteMessage(threadId: string, messageId: string) {
    const rawId = typeof messageId === 'string' ? messageId : String(messageId || '');
    if (!rawId || !Types.ObjectId.isValid(rawId)) {
      throw new BadRequestException(`Invalid message ID format: ${rawId}`);
    }

    const thread = await this.threadModel.findById(threadId);
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);

    const msgIndex = thread.messages.findIndex(
      m => m._id?.toString() === rawId || (m as any).id === rawId
    );
    if (msgIndex === -1) throw new NotFoundException(`Message ${rawId} not found`);

    // Best-effort cleanup: if it's an assistant message with generated images, delete from MinIO
    const msg = thread.messages[msgIndex];
    if (msg.role === 'assistant' && msg.metadata?.images) {
      for (const img of msg.metadata.images) {
        try {
          const key = img.url.includes('/thumbnails/')
            ? img.url.split('/thumbnails/')[1]
            : img.url.split('/api/assets/minio/')[1];
          if (key) {
            await this.minioService.deleteFile(decodeURIComponent(key));
          }
        } catch { /* best effort */ }
      }
    }

    await this.threadModel.findByIdAndUpdate(threadId, {
      $pull: { messages: { _id: new Types.ObjectId(rawId) } }
    });

    return { success: true, threadId, messageId: rawId };
  }

  private async summarizeAndCompress(threadId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>, channel?: any): Promise<{ summary: string }> {
    const result = await this.openaiService.summarizeConversation({ messages, channel });
    await this.logAiOutput({ channelId: '', operation: 'summarize', threadId, inputSummary: `Summarizing ${messages.length} messages`, output: { summary: result.summary }, usage: result.usage });
    return { summary: result.summary };
  }

  private async logAiOutput(params: { channelId: string; operation: string; threadId?: string; videoId?: string; inputSummary: string; output: any; usage?: TokenUsage }) {
    try {
      await this.aiOutputLogModel.create({
        channelId: params.channelId, operation: params.operation, threadId: params.threadId,
        videoId: params.videoId, inputSummary: params.inputSummary, output: params.output,
        promptTokens: params.usage?.promptTokens || 0, completionTokens: params.usage?.completionTokens || 0,
        cachedTokens: params.usage?.cachedTokens || 0, cacheHitRate: params.usage?.cacheHitRate || 0, model: this.modelName,
      });
    } catch (error) { this.logger.error(`Failed to log AI output: ${error.message}`); }
  }

  async uploadAssetOnly(threadId: string, file: Express.Multer.File): Promise<{ url: string; filename: string }> {
    const thread = await this.threadModel.findById(threadId);
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);

    const channelId = thread.channelId.toString();
    const safeFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
    const isMinioReady = await this.minioService.isAvailable().catch(() => false);
    let url: string;

    if (isMinioReady) {
      try {
        const key = `uploads/${channelId}/${Date.now()}_${safeFilename}`;
        url = await this.minioService.uploadBuffer(key, file.buffer, file.mimetype);
      } catch (err: any) {
        this.logger.warn(`MinIO upload failed in uploadAssetOnly (${err.message}), falling back to local...`);
        const filename = `${Date.now()}_${safeFilename}`;
        const genDir = path.join(process.cwd(), 'src', 'assets', 'generated');
        if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
        fs.writeFileSync(path.join(genDir, filename), file.buffer);
        url = `/api/assets/generated/${filename}`;
      }
    } else {
      const filename = `${Date.now()}_${safeFilename}`;
      const genDir = path.join(process.cwd(), 'src', 'assets', 'generated');
      if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
      fs.writeFileSync(path.join(genDir, filename), file.buffer);
      url = `/api/assets/generated/${filename}`;
    }

    return { url, filename: safeFilename };
  }

  async handleFileUpload(threadId: string, file: Express.Multer.File, content?: string) {
    const thread = await this.threadModel.findById(threadId);
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);

    const health = await this.checkThreadHealth(thread);
    if (!health.ok) return { error: health.error, threadId, archived: true };

    // Auto-name from first user message (background, non-blocking)
    this.handleFirstMessage(threadId, thread, content || file.originalname);

    const channel = await this.channelModel.findById(thread.channelId).lean();
    const channelId = thread.channelId.toString();

    // Sanitize filename to prevent path traversal
    const safeFilename = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
    const key = `uploads/${channelId}/${Date.now()}_${safeFilename}`;
    const url = await this.minioService.uploadBuffer(key, file.buffer, file.mimetype);

    let extractedText = '';
    const isPdf = file.mimetype === 'application/pdf';
    const isImage = file.mimetype.startsWith('image/');
    const isText =
      file.mimetype === 'text/plain' ||
      file.mimetype.includes('markdown') ||
      safeFilename.endsWith('.txt') ||
      safeFilename.endsWith('.md');

    if (isPdf) {
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(file.buffer);
        extractedText = data.text.substring(0, 10000);
      } catch (error) {
        this.logger.warn(`PDF parse failed: ${error.message}`);
      }
    } else if (isText) {
      extractedText = file.buffer.toString('utf-8').substring(0, 10000);
    }

    // Build user message
    let userContent = content || '';
    if (isPdf && extractedText) {
      userContent += `\n\n[Uploaded PDF: ${safeFilename}]\n\n${extractedText}`;
    } else if (isText && extractedText) {
      userContent += `\n\n[Uploaded File: ${safeFilename}]\n\n${extractedText}`;
    } else if (isImage) {
      userContent += `\n\n[Image uploaded: ${safeFilename}]`;
    } else {
      userContent += `\n\n[File uploaded: ${safeFilename}]`;
    }

    // Save user message atomically
    const userMsg = {
      role: 'user' as const,
      content: userContent,
      metadata: {
        attachments: [{
          type: isPdf ? 'pdf' as const : 'image' as const,
          url,
          filename: safeFilename,
          extractedText: isPdf ? extractedText : undefined,
        }],
      },
      createdAt: new Date(),
    };
    await this.threadModel.findByIdAndUpdate(threadId, { $push: { messages: userMsg } });

    // Re-load thread for conversation history
    const updatedThread = await this.threadModel.findById(threadId);
    if (!updatedThread) throw new NotFoundException(`Thread ${threadId} not found`);

    // Resolve skill from user-provided content only (not PDF extracted text)
    // If no user text provided (pure file upload), default to 'general' skill
    const resolvedSkill = content?.trim() ? this.skillRegistry.classifyIntent(content) : 'general';

    // Get AI response with RAG context
    const skill = this.skillRegistry.get(resolvedSkill);
    const skillContext = await skill.loadContext(channelId, updatedThread.videoId || undefined);
    const systemPrompt = skill.buildSystemPrompt(channel || {}, skillContext);

    // RAG context
    const ragContext = await this.buildRagContext(userContent, resolvedSkill);

    const dynamicContext = this.skillRegistry.buildDynamicContext(channel || {}, skillContext) + ragContext;
    const conversationHistory = updatedThread.messages.slice(0, -1).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    let aiResponse: { content: string; usage?: TokenUsage };

    if (isImage) {
      // Use base64 Data URL instead of presigned URL — OpenAI can't fetch internal Docker URLs
      const base64 = file.buffer.toString('base64');
      const dataUrl = `data:${file.mimetype};base64,${base64}`;
      aiResponse = await this.openaiService.chatWithVision({
        imageUrl: dataUrl,
        userMessage: userContent,
        systemPrompt,
        conversationHistory,
      });
    } else {
      aiResponse = await this.openaiService.chat({
        messages: [{ role: 'user', content: userContent }],
        channel: channel || undefined,
        conversationHistory,
        systemPromptOverride: systemPrompt,
        dynamicContext,
        temperature: skill.getTemperature?.() ?? 0.7,
      });
    }

    // Save AI response atomically with token tracking
    const assistantMsg: Message = {
      role: 'assistant',
      content: aiResponse.content,
      metadata: { category: resolvedSkill },
      createdAt: new Date(),
    } as any;

    await this.threadModel.findByIdAndUpdate(threadId, {
      $push: { messages: assistantMsg },
      $set: { updatedAt: new Date() },
      $inc: {
        totalPromptTokens: aiResponse.usage?.promptTokens || 0,
        totalCompletionTokens: aiResponse.usage?.completionTokens || 0,
        totalCachedTokens: aiResponse.usage?.cachedTokens || 0,
      },
    });

    // Store in ChromaDB
    try {
      await this.chromaService.upsert('chat_messages', `${threadId}_${updatedThread.messages.length + 1}`,
        `User: ${userContent}\nAssistant: ${aiResponse.content}`,
        { threadId: threadId.toString(), channelId, category: resolvedSkill });
    } catch { /* RAG optional */ }

    // Log AI output
    await this.logAiOutput({
      channelId, operation: 'chat_upload', threadId: threadId.toString(),
      inputSummary: userContent.substring(0, 200), output: { content: aiResponse.content }, usage: aiResponse.usage,
    });

    return {
      ...assistantMsg,
      url,
      userMessage: userMsg,
      metadata: {
        ...assistantMsg.metadata,
        attachments: userMsg.metadata.attachments,
      },
    };
  }

  // ─── Shared helpers ─────────────────────────────────────────────────

  /**
   * Check if thread is active and not expired.
   * Returns { ok: true } or { ok: false, error: string }.
   */
  private async checkThreadHealth(thread: ThreadDocument): Promise<{ ok: boolean; error?: string }> {
    if (thread.status === 'archived') {
      return { ok: false, error: 'This thread has been archived. Start a new conversation.' };
    }
    const daysSinceUpdate = Math.floor((Date.now() - (thread.updatedAt?.getTime() || thread.createdAt?.getTime() || Date.now())) / (1000 * 60 * 60 * 24));
    if (daysSinceUpdate >= THREAD_EXPIRY_DAYS) {
      await this.archiveThread(thread._id.toString(), 'expired_inactivity');
      return { ok: false, error: 'This thread expired due to inactivity. Start a new conversation.' };
    }
    return { ok: true };
  }

  /**
   * Handle first-message auto-naming (returns promise).
   */
  private handleFirstMessage(threadId: string, thread: ThreadDocument, content: string): Promise<string | void> {
    const userMessageCount = thread.messages.filter(m => m.role === 'user').length;
    if (userMessageCount === 0 && (!thread.title || thread.title === 'New Thread')) {
      return this.autoNameThread(threadId, content);
    }
    return Promise.resolve();
  }

  /**
   * Build RAG context from ChromaDB — chat messages, SEO patterns, video metadata, and book passages.
   */
  private async buildRagContext(content: string, resolvedSkill: string): Promise<string> {
    let ragContext = '';
    try {
      const [chatResults, seoResults, videoResults] = await Promise.all([
        this.chromaService.query('chat_messages', content, 3),
        this.chromaService.query('seo_suggestions', content, 2),
        this.chromaService.query('video_metadata', content, 2),
      ]);
      const allResults = [...chatResults, ...seoResults, ...videoResults].filter(r => r.distance < 0.7);
      if (allResults.length > 0) {
        ragContext = '\n\n## RELEVANT CONTEXT FROM PAST INTERACTIONS\n' +
          allResults.map(r => `- ${r.text.substring(0, 200)}`).join('\n');
      }

      // Search client book for script/general — adds authentic voice and story references
      if (resolvedSkill === 'script' || resolvedSkill === 'general') {
        try {
          const bookResults = await this.chromaService.query('client_book', content, 3);
          const relevantBook = bookResults.filter(r => r.distance < 0.75);
          if (relevantBook.length > 0) {
            ragContext += '\n\n## RELEVANT PASSAGES FROM "A ROAR IN HARLEM" (Unique\'s Book)\n' +
              relevantBook.map(r => `- [${r.metadata.type || 'passage'}] ${r.text.substring(0, 300)}`).join('\n');
          }
        } catch { /* book collection may not exist yet */ }
      }
    } catch { /* RAG optional */ }
    return ragContext;
  }

  /**
   * Detect if the user message needs web search / research.
   * Triggers for: outline/script/trends/thumbnail/ideas skills, legal/crime keywords, and research-oriented questions.
   */
  private detectNeedsResearch(message: string, category?: string): boolean {
    // Trends, outline, script, thumbnail, ideas, and competitor skills always benefit from current web research
    if (
      category === 'outline' ||
      category === 'script' ||
      category === 'trends' ||
      category === 'thumbnail' ||
      category === 'ideas' ||
      category === 'competitor'
    ) {
      return true;
    }

    const lower = message.trim().toLowerCase();

    // Short option selection (e.g. "b", "option b", "1", "choice a") — inherit research context
    if (/^(option\s*)?[a-d1-4]$/i.test(lower)) return true;

    // News/current events & criminal case keywords — terms that indicate live news, person lookup, or case status
    const newsKeywords = [
      'latest news', 'recent news', 'current events', 'what happened',
      'breaking news', 'update on', 'just happened', 'this week',
      'today in', 'happening now', 'allegedly', 'trending', 'top stories',
      'trending stories', 'what\'s trending',
      'arrested', 'jail', 'prison', 'trial', 'sentenced', 'verdict',
      'indicted', 'plea deal', 'released', 'charges', 'raided', 'fbi',
      'doj', 'court', 'guilty', 'custody', 'bail', 'investigation',
    ];
    if (newsKeywords.some(kw => lower.includes(kw))) return true;

    // Specific topic/person queries — "tell me about [X]", "what happened to [X]", "thumbnail for [X]"
    if (/\b(tell me about|what happened to|what's going on with|give me info on|research|look up|thumbnail|thumbnails)\b/i.test(lower)) return true;

    return false;
  }

  /**
   * Check if trending topics are fresh (less than 3 days old).
   * Checks the NEWEST topic — if the newest is fresh, trends are usable.
   */
  private areTrendsFresh(trends: any[] | undefined): boolean {
    if (!trends || trends.length === 0) return false;
    const newestFetchAt = Math.max(...trends.map(t => new Date(t.fetchedAt).getTime()));
    const daysSinceFetch = (Date.now() - newestFetchAt) / (1000 * 60 * 60 * 24);
    return daysSinceFetch <= 3;
  }

  /**
   * Parses user input and conversation context for thumbnail directives:
   * - Host removal / inclusion ("remove me", "don't put me", "without host")
   * - Logo removal / inclusion ("no logo", "without logo", "remove logo")
   * - Aspect ratio selection ("reel", "shorts", "tiktok", "9:16", "vertical")
   * - Custom host attachment recognition ("use this for me", "this is me")
   *
   * PRECEDENCE RULE: Directives in the current user prompt strictly override thread history.
   */
  parseClientThumbnailDirectives(
    currentPrompt?: string,
    threadMessages: any[] = [],
    attachments?: Array<{ type: string; url: string }>,
  ): {
    excludeHost?: boolean;
    excludeLogo?: boolean;
    aspectRatio?: '16:9' | '9:16';
    customHostUrl?: string;
  } {
    const result: {
      excludeHost?: boolean;
      excludeLogo?: boolean;
      aspectRatio?: '16:9' | '9:16';
      customHostUrl?: string;
    } = {};

    const promptText = (currentPrompt || '').toLowerCase();

    // Reusable regexes with negation protection for both prompt and thread history scanning
    const hostExclusionRegex = /(?<!don'?t\s+|do\s+not\s+|never\s+)\b(?:remove\s+me|don'?t\s+put\s+me|dont\s+put\s+me|without\s+me|without\s+host|no\s+host|take\s+me\s+out|no\s+me|delete\s+me)\b/i;
    const hostInclusionRegex = /(?<!don'?t\s+|do\s+not\s+|never\s+)\b(?:put\s+me|add\s+me|with\s+me|include\s+me|keep\s+me|use\s+host|with\s+host)\b/i;
    const logoExclusionRegex = /(?<!don'?t\s+|do\s+not\s+|never\s+)\b(?:remove\s+logo|no\s+logo|without\s+logo|delete\s+logo|no\s+brand|without\s+brand)\b/i;
    const logoInclusionRegex = /(?<!don'?t\s+|do\s+not\s+|never\s+)\b(?:add\s+logo|with\s+logo|include\s+logo|keep\s+logo|put\s+logo)\b/i;

    // 1. Check current prompt with negation protection
    if (promptText) {
      if (hostExclusionRegex.test(promptText)) {
        result.excludeHost = true;
      } else if (hostInclusionRegex.test(promptText)) {
        result.excludeHost = false;
      }

      if (logoExclusionRegex.test(promptText)) {
        result.excludeLogo = true;
      } else if (logoInclusionRegex.test(promptText)) {
        result.excludeLogo = false;
      }

      // Aspect ratio auto-detection
      if (/\b(?:reel|reels|short|shorts|tiktok|9:16|vertical)\b/i.test(promptText)) {
        result.aspectRatio = '9:16';
      } else if (/\b(?:16:9|landscape|horizontal|standard\s+video)\b/i.test(promptText)) {
        result.aspectRatio = '16:9';
      }

      // Custom host attachment detection ("use this for me", "this is me", multi-turn supported)
      let customAttachUrl: string | undefined;
      if (attachments && attachments.length > 0) {
        const imgAttach = attachments.find((a) => a.type === 'image' || /\.(png|jpg|jpeg|webp)$/i.test(a.url));
        if (imgAttach) customAttachUrl = imgAttach.url;
      } else if (threadMessages && threadMessages.length > 0) {
        for (const msg of threadMessages.slice().reverse()) {
          if (msg.role === 'user' && (msg.attachments?.length || msg.metadata?.attachments?.length)) {
            const list = msg.attachments || msg.metadata?.attachments || [];
            const imgAttach = list.find((a: any) => a.type === 'image' || /\.(png|jpg|jpeg|webp)$/i.test(a.url || a.path));
            if (imgAttach?.url || imgAttach?.path) {
              customAttachUrl = imgAttach.url || imgAttach.path;
              break;
            }
          }
        }
      }

      if (customAttachUrl) {
        if (/\b(?:use\s+this\s+(?:one\s+)?(?:for\s+me|picture|photo)|this\s+is\s+me|my\s+picture|my\s+photo|with\s+this\s+photo|use\s+my\s+photo)\b/i.test(promptText)) {
          result.customHostUrl = customAttachUrl;
        }
      }
    }

    // 2. Fallback to thread history ONLY if current prompt is silent on the option
    if (result.excludeLogo === undefined && threadMessages.length > 0) {
      for (const msg of threadMessages.slice().reverse()) {
        if (msg.role === 'user' && msg.content) {
          const content = msg.content.toLowerCase();
          if (logoExclusionRegex.test(content)) {
            result.excludeLogo = true;
            break;
          } else if (logoInclusionRegex.test(content)) {
            result.excludeLogo = false;
            break;
          }
        }
      }
    }

    if (result.excludeHost === undefined && threadMessages.length > 0) {
      for (const msg of threadMessages.slice().reverse()) {
        if (msg.role === 'user' && msg.content) {
          const content = msg.content.toLowerCase();
          if (hostExclusionRegex.test(content)) {
            result.excludeHost = true;
            break;
          } else if (hostInclusionRegex.test(content)) {
            result.excludeHost = false;
            break;
          }
        }
      }
    }

    return result;
  }

  /**
   * Generate a thumbnail image using video context, default MAE logo, user reference images & custom layout rules.
   */
  async generateThumbnailImage(
    threadId: string,
    dto: {
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
    const thread = await this.threadModel.findById(threadId);
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);

    // 0. Resolve Video Document for deep Video Context (showType, full video title)
    let videoContextTitle = dto.videoTitle || thread.videoTitle;
    let resolvedShowType: string | undefined;

    let videoDoc: any = null;
    if (thread.videoId) {
      try {
        videoDoc = await this.videoModel.findById(thread.videoId).lean();
        if (videoDoc) {
          videoContextTitle = videoDoc.youtubeTitle || videoDoc.title || videoContextTitle;
          resolvedShowType = videoDoc.showType || undefined;
        }
      } catch { /* optional */ }
    }

    if (!videoContextTitle || videoContextTitle === 'New Thread' || videoContextTitle === 'Video Thread') {
      const firstUserMsg = thread.messages.find((m) => m.role === 'user')?.content;
      videoContextTitle = thread.title && thread.title !== 'New Thread' ? thread.title : firstUserMsg ? firstUserMsg.slice(0, 80) : 'YouTube Video';
    }

    // 1. Inspect user prompt / messages for negative host/logo constraints
    const parsedDirectives = this.parseClientThumbnailDirectives(dto.text, thread.messages);

    const excludeLogo =
      dto.excludeLogo ??
      (dto.logoPosition === 'none' || parsedDirectives.excludeLogo === true);

    const excludeHost =
      dto.excludeHost ??
      (dto.selectedHostImage === 'none' || parsedDirectives.excludeHost === true);

    const resolvedAspectRatio: '16:9' | '9:16' =
      dto.aspectRatio || parsedDirectives.aspectRatio || '16:9';

    const effectiveCustomHostUrl =
      dto.customHostUrl || dto.customHostImage || parsedDirectives.customHostUrl;
    // Canonical host: default to channel default host unless explicitly excluded
    const selectedHost = excludeHost ? undefined : (dto.selectedHostImage || 'default');

    const storyContext = await this.openaiService.extractStoryContextFromThread({
      videoTitle: videoContextTitle,
      videoDescription: videoDoc?.description,
      recentMessages: thread.messages,
      userPrompt: dto.text,
    });

    const result = await this.openaiService.generateThumbnailImage({
      concept: { text: dto.text, description: dto.visual, colors: dto.colors },
      videoTitle: videoContextTitle,
      showType: resolvedShowType,
      selectedHostImage: selectedHost,
      customHostUrl: effectiveCustomHostUrl,
      logoPosition: excludeLogo ? 'none' : (dto.logoPosition || 'top-right'),
      customLayoutInstructions: dto.customLayoutInstructions,
      excludeLogo,
      excludeHost: excludeHost === true,
      aspectRatio: resolvedAspectRatio,
      storyContext,
    });

    const imageObj = {
      id: new Types.ObjectId().toString(),
      url: result.imageUrl,
      cleanBackgroundUrl: result.cleanBackgroundUrl || result.imageUrl,
      prompt: result.revisedPrompt,
      conceptTitle: dto.conceptTitle || 'Concept',
      textOverlay: dto.text || '',
      visualDescription: dto.visual || '',
      selectedHostImage: excludeHost ? 'none' : (selectedHost || (effectiveCustomHostUrl ? 'custom' : 'none')),
      logoPosition: excludeLogo ? 'none' : (dto.logoPosition || 'top-right'),
      aspectRatio: resolvedAspectRatio,
      mode: 'thumbnail',
      createdAt: new Date(),
    };

    if (dto.messageId && Types.ObjectId.isValid(dto.messageId)) {
      await this.threadModel.updateOne(
        { _id: threadId, 'messages._id': new Types.ObjectId(dto.messageId) },
        { $push: { 'messages.$.metadata.images': imageObj } },
      );
    } else {
      const targetMessage = thread.messages.slice().reverse().find(
        (m) => m.role === 'assistant' && (m.content.includes('Concept') || (dto.text && m.content.toLowerCase().includes(dto.text.toLowerCase()))),
      ) || thread.messages.slice().reverse().find((m) => m.role === 'assistant');

      if (targetMessage && targetMessage._id) {
        await this.threadModel.updateOne(
          { _id: threadId, 'messages._id': targetMessage._id },
          { $push: { 'messages.$.metadata.images': imageObj } },
        );
      } else if (thread.messages.length > 0) {
        const lastMsgIdx = thread.messages.length - 1;
        await this.threadModel.updateOne(
          { _id: threadId },
          { $push: { [`messages.${lastMsgIdx}.metadata.images`]: imageObj } },
        );
      }
    }

    return { ...result, image: imageObj };
  }

  /**
   * Generate a scene image (16:9 cinematic b-roll/background).
   * No host face compositing — only optional logo overlay.
   */
  async generateSceneImage(
    threadId: string,
    dto: {
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
    const thread = await this.threadModel.findById(threadId);
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);

    let videoDoc: any = null;
    let videoContextTitle = dto.videoTitle || thread.title;
    if (thread.videoId) {
      try {
        videoDoc = await this.videoModel.findById(thread.videoId).lean();
        if (videoDoc) videoContextTitle = videoDoc.youtubeTitle || videoDoc.title || videoContextTitle;
      } catch { /* optional */ }
    }

    const storyContext = await this.openaiService.extractStoryContextFromThread({
      videoTitle: videoContextTitle,
      videoDescription: videoDoc?.description,
      recentMessages: thread.messages,
      userPrompt: dto.scene,
    });

    const result = await this.openaiService.generateSceneImage({
      scene: dto.scene,
      style: dto.style,
      colors: dto.colors,
      textOverlay: dto.textOverlay,
      videoTitle: videoContextTitle,
      storyContext,
      referenceImageUrl: dto.referenceImageUrl,
    });

    // Optionally composite logo only (no host face)
    let finalImageUrl = result.imageUrl;
    if (dto.logoPosition && dto.logoPosition !== 'none') {
      try {
        const composedBuffer = await this.composerService.composeThumbnail({
          backgroundInput: result.imageUrl,
          logoPosition: dto.logoPosition || 'top-right',
          selectedHostImage: 'none',
          excludeHost: true,
        });
        const isMinioReady = await this.minioService.isAvailable().catch(() => false);
        if (isMinioReady) {
          try {
            finalImageUrl = await this.minioService.uploadThumbnail('system', `scene_composed_${Date.now()}.png`, composedBuffer);
          } catch {
            const filename = `scene_composed_${Date.now()}.png`;
            const genDir = path.join(process.cwd(), 'src', 'assets', 'generated');
            if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
            fs.writeFileSync(path.join(genDir, filename), composedBuffer);
            finalImageUrl = `/api/assets/generated/${filename}`;
          }
        } else {
          const filename = `scene_composed_${Date.now()}.png`;
          const genDir = path.join(process.cwd(), 'src', 'assets', 'generated');
          if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
          fs.writeFileSync(path.join(genDir, filename), composedBuffer);
          finalImageUrl = `/api/assets/generated/${filename}`;
        }
      } catch { /* use raw image if compositing fails */ }
    }

    const imageObj = {
      id: new Types.ObjectId().toString(),
      url: finalImageUrl,
      cleanBackgroundUrl: result.imageUrl,
      prompt: result.revisedPrompt,
      conceptTitle: 'Scene',
      textOverlay: dto.textOverlay || '',
      visualDescription: dto.scene || '',
      isSceneImage: true,
      mode: 'scene',
      createdAt: new Date(),
    };

    // Store in message (same pattern as generateThumbnailImage)
    if (dto.messageId && Types.ObjectId.isValid(dto.messageId)) {
      await this.threadModel.updateOne(
        { _id: threadId, 'messages._id': new Types.ObjectId(dto.messageId) },
        { $push: { 'messages.$.metadata.images': imageObj } },
      );
    } else {
      const targetMessage = thread.messages.slice().reverse().find(m => m.role === 'assistant');
      if (targetMessage && targetMessage._id) {
        await this.threadModel.updateOne(
          { _id: threadId, 'messages._id': targetMessage._id },
          { $push: { 'messages.$.metadata.images': imageObj } },
        );
      } else if (thread.messages.length > 0) {
        const lastMsgIdx = thread.messages.length - 1;
        await this.threadModel.updateOne(
          { _id: threadId },
          { $push: { [`messages.${lastMsgIdx}.metadata.images`]: imageObj } },
        );
      }
    }

    return { ...result, image: imageObj };
  }

  /**
   * Direct image edit — takes base image + prompt + optional reference images.
   * Calls images.edit API directly, stores result in message metadata.
   */
  async editImage(
    threadId: string,
    dto: {
      prompt: string;
      baseImageUrl: string;
      referenceImageUrls?: string[];
      mode?: 'thumbnail' | 'scene';
      selectedHostImage?: string;
      excludeHost?: boolean;
      excludeLogo?: boolean;
      logoPosition?: 'top-left' | 'top-right' | 'none';
      aspectRatio?: '16:9' | '9:16';
      customHostUrl?: string;
      customHostImage?: string;
    },
  ) {
    const thread = await this.threadModel.findById(threadId);
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);

    // Auto-name thread if first message
    this.handleFirstMessage(threadId, thread, dto.prompt);

    let videoDoc: any = null;
    let videoContextTitle = thread.title;
    if (thread.videoId) {
      try {
        videoDoc = await this.videoModel.findById(thread.videoId).lean();
        if (videoDoc) videoContextTitle = videoDoc.youtubeTitle || videoDoc.title || videoContextTitle;
      } catch { /* optional */ }
    }

    // Directives parsing on edit prompt
    const parsedDirectives = this.parseClientThumbnailDirectives(dto.prompt, thread.messages);

    const excludeLogo =
      dto.excludeLogo ??
      (dto.logoPosition === 'none' || parsedDirectives.excludeLogo === true);

    const excludeHost =
      dto.excludeHost ??
      (dto.selectedHostImage === 'none' || parsedDirectives.excludeHost === true);

    // Aspect ratio inheritance: DTO -> parsed prompt -> parent message metadata -> default 16:9
    let resolvedAspectRatio: '16:9' | '9:16' | undefined = dto.aspectRatio || parsedDirectives.aspectRatio;
    if (!resolvedAspectRatio && thread.messages) {
      const cleanBase = (dto.baseImageUrl || '').split('?')[0];
      for (const msg of thread.messages.slice().reverse()) {
        const matchingImg = (msg as any).metadata?.images?.find(
          (img: any) =>
            (img.url && img.url.split('?')[0] === cleanBase) ||
            (img.cleanBackgroundUrl && img.cleanBackgroundUrl.split('?')[0] === cleanBase),
        );
        if (matchingImg?.aspectRatio) {
          resolvedAspectRatio = matchingImg.aspectRatio;
          break;
        }
      }
    }
    const finalAspectRatio: '16:9' | '9:16' = resolvedAspectRatio || '16:9';

    // Build reference images list (including custom host if provided)
    const referenceImageUrls = [...(dto.referenceImageUrls || [])];
    const effectiveCustomHost =
      dto.customHostUrl || dto.customHostImage || parsedDirectives.customHostUrl;
    if (effectiveCustomHost && !referenceImageUrls.includes(effectiveCustomHost)) {
      referenceImageUrls.push(effectiveCustomHost);
    }

    const storyContext = await this.openaiService.extractStoryContextFromThread({
      videoTitle: videoContextTitle,
      videoDescription: videoDoc?.description,
      recentMessages: thread.messages,
      userPrompt: dto.prompt,
    });

    const result = await this.openaiService.editImageWithReference(
      dto.baseImageUrl,
      dto.prompt,
      {
        referenceImageUrls,
        mode: dto.mode || 'thumbnail',
        selectedHostImage: excludeHost ? 'none' : dto.selectedHostImage,
        excludeHost,
        excludeLogo,
        logoPosition: excludeLogo ? 'none' : (dto.logoPosition || 'top-right'),
        aspectRatio: finalAspectRatio,
        storyContext,
      },
    );

    const imageObj = {
      id: new Types.ObjectId().toString(),
      url: result.imageUrl,
      cleanBackgroundUrl: result.cleanBackgroundUrl || result.imageUrl,
      prompt: result.revisedPrompt,
      conceptTitle: 'Edit',
      textOverlay: '',
      visualDescription: dto.prompt,
      selectedHostImage: excludeHost ? 'none' : dto.selectedHostImage,
      logoPosition: excludeLogo ? 'none' : (dto.logoPosition || 'top-right'),
      aspectRatio: finalAspectRatio,
      mode: dto.mode || 'thumbnail',
      createdAt: new Date(),
    };

    // Store as assistant message with image
    const assistantMessage: Message = {
      role: 'assistant',
      content: `Edited image: ${dto.prompt}`,
      metadata: {
        category: 'image',
        images: [imageObj],
      },
      createdAt: new Date(),
    } as any;

    await this.threadModel.findByIdAndUpdate(threadId, {
      $push: { messages: assistantMessage },
      $set: { updatedAt: new Date() },
    });

    return { imageUrl: result.imageUrl, image: imageObj };
  }

  /**
   * Direct image generation — takes a text prompt, generates image directly.
   * No concept cards, no intermediate steps. For "Generate Image" mode.
   */
  async generateImageDirect(
    threadId: string,
    dto: {
      prompt: string;
      videoTitle?: string;
      logoPosition?: 'top-right' | 'none';
    },
  ) {
    const thread = await this.threadModel.findById(threadId);
    if (!thread) throw new NotFoundException(`Thread ${threadId} not found`);

    // Auto-name thread if first message
    this.handleFirstMessage(threadId, thread, dto.prompt);

    let videoDoc: any = null;
    let videoContextTitle = dto.videoTitle || thread.title;
    if (thread.videoId) {
      try {
        videoDoc = await this.videoModel.findById(thread.videoId).lean();
        if (videoDoc) videoContextTitle = videoDoc.youtubeTitle || videoDoc.title || videoContextTitle;
      } catch { /* optional */ }
    }

    const storyContext = await this.openaiService.extractStoryContextFromThread({
      videoTitle: videoContextTitle,
      videoDescription: videoDoc?.description,
      recentMessages: thread.messages,
      userPrompt: dto.prompt,
    });

    const result = await this.openaiService.generateSceneImage({
      scene: dto.prompt,
      style: 'Cinematic, dramatic, realistic photography',
      colors: '',
      videoTitle: videoContextTitle,
      storyContext,
    });

    // Optionally composite logo only if explicitly requested
    let finalImageUrl = result.imageUrl;
    if (dto.logoPosition && dto.logoPosition !== 'none') {
      try {
        const composedBuffer = await this.composerService.composeThumbnail({
          backgroundInput: result.imageUrl,
          logoPosition: dto.logoPosition || 'top-right',
          selectedHostImage: 'none',
          excludeHost: true,
        });
        const isMinioReady = await this.minioService.isAvailable().catch(() => false);
        if (isMinioReady) {
          try {
            finalImageUrl = await this.minioService.uploadThumbnail('system', `direct_${Date.now()}.png`, composedBuffer);
          } catch {
            const filename = `direct_${Date.now()}.png`;
            const genDir = path.join(process.cwd(), 'src', 'assets', 'generated');
            if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
            fs.writeFileSync(path.join(genDir, filename), composedBuffer);
            finalImageUrl = `/api/assets/generated/${filename}`;
          }
        } else {
          const filename = `direct_${Date.now()}.png`;
          const genDir = path.join(process.cwd(), 'src', 'assets', 'generated');
          if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
          fs.writeFileSync(path.join(genDir, filename), composedBuffer);
          finalImageUrl = `/api/assets/generated/${filename}`;
        }
      } catch { /* use raw image */ }
    }

    const imageObj = {
      id: new Types.ObjectId().toString(),
      url: finalImageUrl,
      cleanBackgroundUrl: result.imageUrl,
      prompt: result.revisedPrompt,
      conceptTitle: 'Generated',
      textOverlay: '',
      visualDescription: dto.prompt,
      mode: 'scene' as const,
      aspectRatio: '16:9' as const,
      createdAt: new Date(),
    };

    const assistantMessage: Message = {
      role: 'assistant',
      content: dto.prompt,
      metadata: {
        category: 'image',
        images: [imageObj],
      },
      createdAt: new Date(),
    } as any;

    await this.threadModel.findByIdAndUpdate(threadId, {
      $push: { messages: assistantMessage },
      $set: { updatedAt: new Date() },
    });

    return { imageUrl: finalImageUrl, image: imageObj };
  }
}

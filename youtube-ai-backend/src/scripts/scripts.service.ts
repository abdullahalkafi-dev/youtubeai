import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection } from 'mongoose';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { Script, ScriptDocument } from '../mongo/schemas/script.schema';
import { ScriptVersion, ScriptVersionDocument } from '../mongo/schemas/script-version.schema';
import { Thread, ThreadDocument } from '../mongo/schemas/thread.schema';
import { CreateScriptDto, SaveScriptDto, ScriptQueryDto, BeautifyScriptDto } from './dto/script.dto';
import { ChromaService } from '../chroma/chroma.service';
import { OpenAIService } from '../openai/openai.service';
import { leanDoc, leanDocs } from '../common/utils/lean';

function calculateStats(content: string): { wordCount: number; estimatedDurationMinutes: number } {
  if (!content) return { wordCount: 0, estimatedDurationMinutes: 0 };
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 140));
  return { wordCount: words, estimatedDurationMinutes: minutes };
}

function sanitizeTitle(title: string): string {
  if (!title) return '';
  return title
    .replace(/^[🎙\s*#"'“”]+|[🎙\s*#"'“”]+$/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

function isGenericTitle(title?: string): boolean {
  if (!title) return true;
  const clean = sanitizeTitle(title);
  if (clean.length < 4) return true;
  const genericPatterns = [
    /^(?:🎙\s*)?LIVE SCRIPT/i,
    /^TELEPROMPTER/i,
    /^ACCURACY NOTE/i,
    /^IMPORTANT ACCURACY/i,
    /^LEGAL STATUS/i,
    /^BEFORE YOU RECORD/i,
    /^SCRIPT DRAFT/i,
    /^FULL SCRIPT/i,
    /^6-PART SCRIPT/i,
    /^BEAUTIFIED TELEPROMPTER/i,
    /^YOUTUBE (?:VIDEO )?SCRIPT/i,
    /^PRODUCTION PACKAGE/i,
    /^VIDEO TOPIC IDEAS/i,
    /^UNTITLED/i,
    /^AI CHAT/i,
    /^SECTION \d+/i,
    /^COLD OPEN/i,
    /^WHAT HAPPENED/i,
    /^UNIQUE MECCA BREAKDOWN/i,
    /^THE HUMAN COST/i,
    /^THE YOUTH WARNING/i,
    /^FINAL JEWEL/i,
    /^10 VIRAL QUESTIONS/i,
  ];
  return genericPatterns.some((rx) => rx.test(clean));
}

function extractTopicTitle(content: string, fallbackTitle?: string): string {
  if (!content) return fallbackTitle || 'YouTube Video Script';

  // 1. Explicit AI Contract: # SCRIPT TITLE: [Title]
  const explicitMatch = content.match(/(?:^|\n)(?:#+\s*)?(?:(?:Episode|Script|Video)\s+)?Title:\s*["“]?([^"\n\r”]+)["”]?/i);
  if (explicitMatch && explicitMatch[1]) {
    const clean = sanitizeTitle(explicitMatch[1]);
    if (!isGenericTitle(clean)) return clean;
  }

  // 2. Quoted Headline on its own line near the start
  const quotedMatch = content.match(/(?:^|\n)\s*["“]([^"”\n\r]{6,120})["”]\s*(?:\n|$)/);
  if (quotedMatch && quotedMatch[1]) {
    const clean = sanitizeTitle(quotedMatch[1]);
    if (!isGenericTitle(clean)) return clean;
  }

  // 3. Markdown Heading # or ## near top
  const headingMatches = content.matchAll(/(?:^|\n)(?:#{1,3})\s+([^#\n\r]{6,120})(?:\n|$)/g);
  for (const m of headingMatches) {
    const candidate = sanitizeTitle(m[1]);
    if (!isGenericTitle(candidate)) {
      return candidate;
    }
  }

  if (fallbackTitle && !isGenericTitle(fallbackTitle)) {
    return sanitizeTitle(fallbackTitle);
  }

  return 'YouTube Video Script';
}

@Injectable()
export class ScriptsService {
  private readonly logger = new Logger(ScriptsService.name);

  constructor(
    @InjectModel(Script.name) private readonly scriptModel: Model<ScriptDocument>,
    @InjectModel(ScriptVersion.name) private readonly versionModel: Model<ScriptVersionDocument>,
    @InjectModel(Thread.name) private readonly threadModel: Model<ThreadDocument>,
    @InjectConnection() private readonly connection: Connection,
    @InjectQueue('script-vector-sync') private readonly vectorSyncQueue: Queue,
    private readonly chromaService: ChromaService,
    private readonly openaiService: OpenAIService,
  ) {}

  private async enqueueVectorSync(scriptId: string, channelId: string) {
    try {
      await this.vectorSyncQueue.add(
        'sync-script-vector',
        { scriptId, channelId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: { count: 500 },
          removeOnFail: { count: 100 },
        },
      );
    } catch (err: any) {
      this.logger.warn(`Failed to enqueue vector sync for script ${scriptId}: ${err.message}`);
    }
  }

  async createScript(channelId: string, userId: string, dto: CreateScriptDto) {
    const stats = calculateStats(dto.content);
    const wordCount = dto.wordCount || stats.wordCount;
    const estimatedDurationMinutes = dto.estimatedDurationMinutes || stats.estimatedDurationMinutes;
    const resolvedTitle = isGenericTitle(dto.title) ? extractTopicTitle(dto.content, dto.title) : dto.title;

    const script = await this.scriptModel.create({
      channelId: new Types.ObjectId(channelId),
      userId: new Types.ObjectId(userId),
      threadId: dto.threadId && Types.ObjectId.isValid(dto.threadId) ? new Types.ObjectId(dto.threadId) : undefined,
      messageId: dto.messageId,
      videoId: dto.videoId,
      title: resolvedTitle,
      content: dto.content,
      blocks: dto.blocks || [],
      wordCount,
      estimatedDurationMinutes,
      tags: dto.tags || [],
      source: dto.source || 'ai_chat',
      formatType: dto.formatType || 'teleprompter_beat',
      isFavorite: false,
      vectorSyncStatus: 'pending',
      currentVersion: 1,
    });

    // Create initial v1 snapshot
    try {
      await this.versionModel.create({
        scriptId: script._id,
        versionNumber: 1,
        title: resolvedTitle,
        content: dto.content,
        blocks: dto.blocks || [],
        wordCount,
        estimatedDurationMinutes,
        changeDescription: 'Initial Creation',
        createdBy: dto.source === 'manual_import' ? 'manual_import' : 'ai_generated',
        userId: new Types.ObjectId(userId),
      });
    } catch (err: any) {
      this.logger.warn(`Failed to create initial version for script ${script._id}: ${err.message}`);
    }

    // Link scriptId back to thread message metadata atomically if created from chat
    if (dto.threadId && dto.messageId && Types.ObjectId.isValid(dto.threadId)) {
      const messageOid = Types.ObjectId.isValid(dto.messageId) ? new Types.ObjectId(dto.messageId) : null;
      if (messageOid) {
        try {
          await this.threadModel.updateOne(
            { _id: new Types.ObjectId(dto.threadId), 'messages._id': messageOid },
            { $set: { 'messages.$.metadata.scriptId': script._id.toString() } },
          );
        } catch (err: any) {
          this.logger.warn(`Failed to link scriptId to thread message: ${err.message}`);
        }
      }
    }

    await this.enqueueVectorSync(script._id.toString(), channelId);
    return leanDoc(script);
  }

  async findAll(channelId: string, query: ScriptQueryDto) {
    const filter: any = { channelId: new Types.ObjectId(channelId) };

    if (query.source && query.source !== 'all') {
      filter.source = query.source;
    }

    if (query.favoriteOnly === 'true') {
      filter.isFavorite = true;
    }

    if (query.timeFilter && query.timeFilter !== 'all') {
      const now = new Date();
      if (query.timeFilter === 'today') {
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        filter.createdAt = { $gte: start };
      } else if (query.timeFilter === 'week') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        filter.createdAt = { $gte: sevenDaysAgo };
      } else if (query.timeFilter === 'month') {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        filter.createdAt = { $gte: thirtyDaysAgo };
      }
    }

    let sort: any = { updatedAt: -1 };
    if (query.sortBy === 'duration') {
      sort = { estimatedDurationMinutes: -1 };
    } else if (query.sortBy === 'title') {
      sort = { title: 1 };
    }

    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.scriptModel.find(filter).sort(sort).skip(skip).limit(limit).lean(),
      this.scriptModel.countDocuments(filter),
    ]);

    return {
      items: leanDocs(items),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(channelId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid script ID');
    const script = await this.scriptModel.findOne({
      _id: new Types.ObjectId(id),
      channelId: new Types.ObjectId(channelId),
    }).lean();

    if (!script) throw new NotFoundException(`Script ${id} not found`);
    return leanDoc(script);
  }

  async saveChanges(channelId: string, userId: string, scriptId: string, dto: SaveScriptDto) {
    if (!Types.ObjectId.isValid(scriptId)) throw new BadRequestException('Invalid script ID');
    const script = await this.findById(channelId, scriptId);

    const stats = calculateStats(dto.content);
    const wordCount = dto.wordCount || stats.wordCount;
    const estimatedDurationMinutes = dto.estimatedDurationMinutes || stats.estimatedDurationMinutes;
    const nextVersion = dto.expectedVersion + 1;

    let updatedScript: any = null;

    // Check if MongoDB supports transactions (Replica Set)
    let hasSession = false;
    let session: any = null;
    try {
      session = await this.connection.startSession();
      hasSession = true;
    } catch {
      hasSession = false;
    }

    if (hasSession && session) {
      try {
        await session.withTransaction(async () => {
          // 1. Insert snapshot into script_versions
          await this.versionModel.create([{
            scriptId: new Types.ObjectId(scriptId),
            versionNumber: nextVersion,
            title: dto.title,
            content: dto.content,
            blocks: dto.blocks || [],
            wordCount,
            estimatedDurationMinutes,
            changeDescription: dto.changeDescription || `Version ${nextVersion}`,
            createdBy: 'user_edit',
            userId: new Types.ObjectId(userId),
          }], { session });

          // 2. Perform atomic OCC compare-and-swap update
          const updated = await this.scriptModel.findOneAndUpdate(
            { _id: new Types.ObjectId(scriptId), currentVersion: dto.expectedVersion, channelId: new Types.ObjectId(channelId) },
            {
              $set: {
                title: dto.title,
                content: dto.content,
                blocks: dto.blocks || [],
                wordCount,
                estimatedDurationMinutes,
                tags: dto.tags || script.tags || [],
                vectorSyncStatus: 'pending',
              },
              $inc: { currentVersion: 1 },
            },
            { new: true, session },
          ).lean();

          if (!updated) {
            throw new ConflictException('Script was modified by another session. Please reload the latest version.');
          }
          updatedScript = updated;
        });
      } catch (err: any) {
        if (err instanceof ConflictException) throw err;
        // Fallback to non-transaction if transaction numbers error
        if (err.message && err.message.includes('Transaction numbers are only allowed')) {
          hasSession = false;
        } else {
          throw err;
        }
      } finally {
        await session.endSession().catch(() => {});
      }
    }

    // Fallback path: Standalone MongoDB without replica set
    if (!hasSession || !updatedScript) {
      try {
        // 1. Insert Version Snapshot First (unique compound index will reject duplicates)
        await this.versionModel.create({
          scriptId: new Types.ObjectId(scriptId),
          versionNumber: nextVersion,
          title: dto.title,
          content: dto.content,
          blocks: dto.blocks || [],
          wordCount,
          estimatedDurationMinutes,
          changeDescription: dto.changeDescription || `Version ${nextVersion}`,
          createdBy: 'user_edit',
          userId: new Types.ObjectId(userId),
        });
      } catch (err: any) {
        if (err.code === 11000) {
          throw new ConflictException('Script was modified by another session. Please reload the latest version.');
        }
        throw err;
      }

      // 2. Execute OCC Update
      const updated = await this.scriptModel.findOneAndUpdate(
        { _id: new Types.ObjectId(scriptId), currentVersion: dto.expectedVersion, channelId: new Types.ObjectId(channelId) },
        {
          $set: {
            title: dto.title,
            content: dto.content,
            blocks: dto.blocks || [],
            wordCount,
            estimatedDurationMinutes,
            tags: dto.tags || script.tags || [],
            vectorSyncStatus: 'pending',
          },
          $inc: { currentVersion: 1 },
        },
        { new: true },
      ).lean();

      if (!updated) {
        // Rollback orphaned version snapshot
        await this.versionModel.deleteOne({ scriptId: new Types.ObjectId(scriptId), versionNumber: nextVersion }).catch(() => {});
        throw new ConflictException('Script was modified by another session. Please reload the latest version.');
      }
      updatedScript = updated;
    }

    await this.enqueueVectorSync(scriptId, channelId);
    return leanDoc(updatedScript);
  }

  async restoreVersion(
    channelId: string,
    userId: string,
    scriptId: string,
    targetVersionNumber: number,
    expectedVersion?: number,
  ) {
    if (!Types.ObjectId.isValid(scriptId)) throw new BadRequestException('Invalid script ID');
    const script = await this.findById(channelId, scriptId);

    if (expectedVersion !== undefined && script.currentVersion !== expectedVersion) {
      throw new ConflictException('Script was modified by another session. Please reload before restoring.');
    }

    const targetVersion = await this.versionModel.findOne({
      scriptId: new Types.ObjectId(scriptId),
      versionNumber: targetVersionNumber,
    }).lean();

    if (!targetVersion) {
      throw new NotFoundException(`Version ${targetVersionNumber} not found for script ${scriptId}`);
    }

    const nextVersionNumber = script.currentVersion + 1;

    // Insert append-only snapshot for nextVersionNumber
    const newVersionDoc = await this.versionModel.create({
      scriptId: new Types.ObjectId(scriptId),
      versionNumber: nextVersionNumber,
      title: targetVersion.title,
      content: targetVersion.content,
      blocks: targetVersion.blocks || [],
      wordCount: targetVersion.wordCount,
      estimatedDurationMinutes: targetVersion.estimatedDurationMinutes,
      changeDescription: `Restored from Version ${targetVersionNumber}`,
      createdBy: 'restored_version',
      userId: new Types.ObjectId(userId),
    });

    const filter: any = { _id: new Types.ObjectId(scriptId), channelId: new Types.ObjectId(channelId) };
    if (expectedVersion !== undefined) {
      filter.currentVersion = expectedVersion;
    }

    const updated = await this.scriptModel.findOneAndUpdate(
      filter,
      {
        $set: {
          title: targetVersion.title,
          content: targetVersion.content,
          blocks: targetVersion.blocks || [],
          wordCount: targetVersion.wordCount,
          estimatedDurationMinutes: targetVersion.estimatedDurationMinutes,
          vectorSyncStatus: 'pending',
        },
        $inc: { currentVersion: 1 },
      },
      { new: true },
    ).lean();

    if (!updated) {
      // Clean up the uncommitted version snapshot to avoid orphaned records
      await this.versionModel.deleteOne({ _id: newVersionDoc._id }).catch(() => {});
      throw new ConflictException('Script was modified by another session during restore.');
    }

    await this.enqueueVectorSync(scriptId, channelId);
    return leanDoc(updated);
  }

  async getVersions(channelId: string, scriptId: string) {
    await this.findById(channelId, scriptId);
    const versions = await this.versionModel.find({
      scriptId: new Types.ObjectId(scriptId),
    }).sort({ versionNumber: -1 }).lean();

    return leanDocs(versions);
  }

  async toggleFavorite(channelId: string, scriptId: string) {
    const script = await this.findById(channelId, scriptId);
    const updated = await this.scriptModel.findByIdAndUpdate(
      new Types.ObjectId(scriptId),
      { $set: { isFavorite: !script.isFavorite } },
      { new: true },
    ).lean();
    return leanDoc(updated);
  }

  async deleteScript(channelId: string, scriptId: string) {
    await this.findById(channelId, scriptId);

    await Promise.all([
      this.scriptModel.findByIdAndDelete(new Types.ObjectId(scriptId)),
      this.versionModel.deleteMany({ scriptId: new Types.ObjectId(scriptId) }),
      this.chromaService.delete('scripts', scriptId).catch(() => {}),
    ]);

    return { success: true, scriptId };
  }

  async hybridSearch(channelId: string, queryText: string, limit = 20) {
    const cleanQuery = queryText?.trim();
    if (!cleanQuery) {
      return this.findAll(channelId, { limit });
    }

    const channelOid = new Types.ObjectId(channelId);

    // 1. Parallel execution: Vector Query + MongoDB $text Query
    const [vectorResults, textResults] = await Promise.all([
      this.chromaService.query('scripts', cleanQuery, limit * 2, { channelId: String(channelId) }).catch((err) => {
        this.logger.warn(`ChromaDB script query failed: ${err.message}`);
        return [];
      }),
      this.scriptModel.find(
        { $text: { $search: cleanQuery }, channelId: channelOid },
        { score: { $meta: 'textScore' } },
      ).sort({ score: { $meta: 'textScore' } }).limit(limit * 2).lean().catch((err) => {
        this.logger.warn(`MongoDB $text script query failed: ${err.message}`);
        return [];
      }),
    ]);

    // 2. Reciprocal Rank Fusion (RRF)
    const RRF_K = 60;
    const rrfScores = new Map<string, number>();

    vectorResults.forEach((res: any, rank: number) => {
      const id = res?.id || res?._id;
      if (id) {
        const score = 1 / (RRF_K + rank + 1);
        rrfScores.set(id.toString(), (rrfScores.get(id.toString()) || 0) + score);
      }
    });

    textResults.forEach((doc: any, rank: number) => {
      const id = doc?._id?.toString() || doc?.id;
      if (id) {
        const score = 1 / (RRF_K + rank + 1);
        rrfScores.set(id.toString(), (rrfScores.get(id.toString()) || 0) + score);
      }
    });

    // Fallback: If both returned 0 results, try regex title match
    if (rrfScores.size === 0) {
      const regexDocs = await this.scriptModel.find({
        channelId: channelOid,
        title: { $regex: cleanQuery, $options: 'i' },
      }).limit(limit).lean();
      return { items: leanDocs(regexDocs), total: regexDocs.length, query: cleanQuery };
    }

    // Sort IDs by highest RRF score
    const sortedIds = Array.from(rrfScores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => new Types.ObjectId(id));

    // Fetch matching docs preserving RRF order
    const docs = await this.scriptModel.find({ _id: { $in: sortedIds } }).lean();
    const docMap = new Map(docs.map(d => [d._id.toString(), d]));
    const rankedDocs = sortedIds.map(id => docMap.get(id.toString())).filter(Boolean);

    return {
      items: leanDocs(rankedDocs),
      total: rankedDocs.length,
      query: cleanQuery,
    };
  }

  async beautifyScript(dto: BeautifyScriptDto) {
    const prompt = `You are an expert teleprompter script formatter for YouTube criminal psychology and storytelling videos.
Transform the following raw, unstructured text into a professional teleprompter script using strict spoken cadence rules.

FORMATTING RULES:
1. Main Episode Title: # SCRIPT TITLE: [TOPIC HEADLINE]
2. Numbered Section Titles: ## 1. SECTION TITLE
3. Sub-sections: **➤ A. — SUB-SECTION TITLE**
4. Lead thoughts: **• Main lead thought sentence**
5. Spoken lines: Staggered blockquotes with one punchy, natural breath per line (4-10 words):
   > Line one.
   >
   > Line two.
6. Stage cues: Insert [BEAT] for pauses and [PAUSE] for dramatic scene changes.
7. Jewels: ### 💎 JEWEL followed by bold moral lesson and spoken takeaways.
8. 10 Viral Questions: # 10 VIRAL QUESTIONS followed by numbered bold questions and blockquote probes.
9. Final Jewel: ### 💎 FINAL JEWEL

CRITICAL: Preserve all original facts, names, and narrative points. Do not invent false legal claims.

RAW TEXT:
${dto.rawText}`;

    const formatted = await this.openaiService.chatFast({
      systemPrompt: 'You are a master script formatter. Output ONLY the clean formatted teleprompter markdown, with no extra conversational preamble or closing comments.',
      userMessage: prompt,
      temperature: 0.3,
      maxCompletionTokens: 16384,
    });

    const stats = calculateStats(formatted);
    const resolvedTitle = isGenericTitle(dto.title) ? extractTopicTitle(formatted, dto.title) : (dto.title || 'YouTube Video Script');
    return {
      title: resolvedTitle,
      content: formatted,
      wordCount: stats.wordCount,
      estimatedDurationMinutes: stats.estimatedDurationMinutes,
    };
  }

  async retryVectorSync(channelId: string, scriptId: string) {
    await this.findById(channelId, scriptId);
    await this.scriptModel.findByIdAndUpdate(new Types.ObjectId(scriptId), {
      $set: { vectorSyncStatus: 'pending' },
    });
    await this.enqueueVectorSync(scriptId, channelId);
    return { success: true, scriptId, status: 'pending' };
  }

  async getStats(channelId: string) {
    const channelOid = new Types.ObjectId(channelId);
    const [result] = await this.scriptModel.aggregate([
      { $match: { channelId: channelOid } },
      {
        $group: {
          _id: null,
          totalScripts: { $sum: 1 },
          totalWords: { $sum: '$wordCount' },
          totalMinutes: { $sum: '$estimatedDurationMinutes' },
        },
      },
    ]);

    const totalScripts = result?.totalScripts || 0;
    const totalWords = result?.totalWords || 0;
    const totalMinutes = result?.totalMinutes || 0;

    return {
      totalScripts,
      totalSpokenHours: Math.round((totalMinutes / 60) * 10) / 10,
      averageWordCount: totalScripts > 0 ? Math.round(totalWords / totalScripts) : 0,
    };
  }
}

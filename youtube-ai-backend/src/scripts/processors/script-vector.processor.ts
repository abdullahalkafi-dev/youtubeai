import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Script, ScriptDocument } from '../../mongo/schemas/script.schema';
import { ChromaService } from '../../chroma/chroma.service';

export interface ScriptVectorJobData {
  scriptId: string;
  channelId: string;
}

function extractEmbedSummary(content: string): string {
  if (!content) return '';
  const sections = content.split(/(?=^##\s+)/gm);
  if (sections.length > 1) {
    return sections.slice(0, 3).join('\n').substring(0, 3000);
  }
  return content.substring(0, 2000);
}

@Processor('script-vector-sync')
export class ScriptVectorProcessor {
  private readonly logger = new Logger(ScriptVectorProcessor.name);

  constructor(
    @InjectModel(Script.name) private readonly scriptModel: Model<ScriptDocument>,
    private readonly chromaService: ChromaService,
  ) {}

  @Process('sync-script-vector')
  async handleScriptVectorSync(job: Job<ScriptVectorJobData>) {
    const { scriptId, channelId } = job.data;
    this.logger.log(`Processing ChromaDB vector sync for script ${scriptId}`);

    const script = await this.scriptModel.findById(new Types.ObjectId(scriptId));
    if (!script) {
      this.logger.warn(`Script ${scriptId} not found during vector sync, skipping`);
      return;
    }

    const summary = extractEmbedSummary(script.content);
    const textToEmbed = `Title: ${script.title}\nSummary: ${summary}\nTags: ${(script.tags || []).join(', ')}`;

    await this.chromaService.upsert('scripts', scriptId, textToEmbed, {
      channelId: String(channelId),
      scriptId,
      threadId: script.threadId?.toString() || '',
      source: script.source || 'ai_chat',
      wordCount: script.wordCount || 0,
      version: script.currentVersion || 1,
      updatedAt: new Date().toISOString(),
    });

    await this.scriptModel.findByIdAndUpdate(script._id, {
      $set: { vectorSyncStatus: 'synced' },
    });

    this.logger.log(`Successfully synced script ${scriptId} to ChromaDB`);
  }

  @OnQueueFailed()
  async onFailed(job: Job<ScriptVectorJobData>, error: Error) {
    this.logger.error(`Vector sync job ${job.id} failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${error.message}`);
    if (job.attemptsMade >= (job.opts.attempts || 3)) {
      try {
        await this.scriptModel.findByIdAndUpdate(new Types.ObjectId(job.data.scriptId), {
          $set: { vectorSyncStatus: 'failed' },
        });
      } catch { /* best effort */ }
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job<ScriptVectorJobData>) {
    this.logger.log(`Vector sync job ${job.id} completed successfully`);
  }
}

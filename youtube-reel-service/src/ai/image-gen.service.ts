import { Inject, Injectable, Logger } from '@nestjs/common';
import OpenAI, { toFile } from 'openai';
import * as crypto from 'crypto';
import { AppConfig, CONFIG } from '../config/config';
import { toOpenAiCreditsError } from '../common/errors';

export class ImageRefusedError extends Error {}

export interface ImageRequest {
  prompt: string;
  /** WIDTHxHEIGHT, multiples of 16. */
  size: string;
  /** Reference photos (e.g. a real person's verified photo) → the edits endpoint. */
  references?: Array<{ name: string; data: Buffer }>;
  /** Stable id of the channel (hashed before sending). */
  channelId: string;
  task: string;
}

/**
 * GPT Image calls (gpt-image-2.5-flare by default, low quality for cost). JPEG out for speed.
 * Retries rate-limit/server errors with backoff; never retries a moderation refusal (throws ImageRefusedError).
 */
@Injectable()
export class ImageGenService {
  private readonly logger = new Logger(ImageGenService.name);
  private readonly client: OpenAI;

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    this.client = new OpenAI({ apiKey: cfg.OPENAI_API_KEY, baseURL: cfg.OPENAI_BASE_URL || undefined, timeout: 3 * 60_000, maxRetries: 0 });
  }

  async generate(req: ImageRequest): Promise<{ data: Buffer; outputTokens: number }> {
    const safety_identifier = crypto.createHash('sha256').update(`reels:${req.channelId}`).digest('hex').slice(0, 64);
    const common = {
      model: this.cfg.REEL_IMAGE_MODEL,
      prompt: req.prompt.slice(0, 3800),
      size: req.size,
      quality: this.cfg.REEL_IMAGE_QUALITY,
      output_format: 'jpeg',
      output_compression: 88,
      safety_identifier,
    } as Record<string, unknown>;

    for (let attempt = 1; ; attempt++) {
      const started = Date.now();
      try {
        const res: any = req.references?.length
          ? await this.client.images.edit({
              ...common,
              image: await Promise.all(req.references.map((r, i) => toFile(r.data, `ref-${i}.jpg`, { type: 'image/jpeg' }))),
            } as any)
          : await this.client.images.generate(common as any);
        const b64 = res?.data?.[0]?.b64_json;
        if (!b64) throw new Error('Image API returned no image');
        const outputTokens = res?.usage?.output_tokens ?? 0;
        this.logger.log(`[${req.task}] ${this.cfg.REEL_IMAGE_MODEL}/${this.cfg.REEL_IMAGE_QUALITY} ${req.size}${req.references?.length ? ' +ref' : ''} ${Date.now() - started}ms out=${outputTokens}`);
        return { data: Buffer.from(b64, 'base64'), outputTokens };
      } catch (err: any) {
        const creditsError = toOpenAiCreditsError(err);
        if (creditsError) throw creditsError;
        const code = err?.code ?? err?.error?.code;
        const type = err?.type ?? err?.error?.type;
        if (code === 'moderation_blocked' || type === 'image_generation_user_error' || err?.status === 400) {
          throw new ImageRefusedError(err?.message ?? 'Image request refused');
        }
        const retryable = err?.status === 429 || (err?.status >= 500 && err?.status < 600) || /timeout|ECONNRESET|fetch failed/i.test(String(err?.message));
        if (!retryable || attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 4000 * attempt));
      }
    }
  }
}

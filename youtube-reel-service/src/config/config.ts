import { z } from 'zod';
import * as path from 'path';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : parseInt(v, 10)))
    .pipe(z.number().int());

const str = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v));

const EnvSchema = z.object({
  NODE_ENV: str('production'),
  PORT: int(5002),

  MONGODB_URI: z.string().min(1),
  REDIS_URL: str('redis://redis:6379'),

  MINIO_ENDPOINT: str('minio'),
  MINIO_PORT: int(9000),
  MINIO_USE_SSL: bool(false),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),

  JWT_SECRET: z.string().min(1),
  REEL_SECRET_KEY: str(''),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: str(''),
  OPENAI_REEL_MODEL: str('gpt-6.1-sol'),
  OPENAI_REEL_FAST_MODEL: str('gpt-6-luna'),
  OPENAI_REEL_REASONING_EFFORT: str('high'),
  OPENAI_STT_MODEL: str('whisper-1'),
  OPENAI_EMBED_MODEL: str('text-embedding-3-small'),

  REELS_ENABLED: bool(true),

  REEL_WORK_DIR: str('/work'),
  REEL_ASSETS_DIR: str(''),
  YTDLP_BIN: str('yt-dlp'),
  FFMPEG_BIN: str('ffmpeg'),
  FFPROBE_BIN: str('ffprobe'),

  REEL_RENDER_CONCURRENCY: int(1),
  REEL_FFMPEG_THREADS: int(2),
  REEL_DOWNLOAD_CONCURRENCY: int(2),
  REEL_ANALYZE_CONCURRENCY: int(2),
  REEL_CAMPAIGN_CONCURRENCY: int(2),
  REEL_MAX_REELS_PER_CAMPAIGN: int(10),
  REEL_MAX_SOURCES_PER_CAMPAIGN: int(10),
  REEL_TOKEN_BUDGET: int(3_000_000),
  REEL_RANGE_COOLDOWN_DAYS: int(120),
  REEL_MIN_FREE_DISK_GB: int(10),
  REEL_DOWNLOAD_DAILY_CAP: int(40),
  REEL_SOURCE_CACHE_GB: int(40),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  assetsDir: string;
  fontsDir: string;
  secretKey: string;
};

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid reel-service environment: ${issues}`);
  }
  const env = parsed.data;
  const assetsDir = env.REEL_ASSETS_DIR || path.resolve(__dirname, '..', '..', 'assets');
  cached = {
    ...env,
    assetsDir,
    fontsDir: path.join(assetsDir, 'fonts'),
    // Cookie encryption key: dedicated secret if provided, otherwise derived from JWT secret.
    secretKey: env.REEL_SECRET_KEY || `${env.JWT_SECRET}::reel-secrets`,
  };
  return cached;
}

export const CONFIG = Symbol('REEL_CONFIG');

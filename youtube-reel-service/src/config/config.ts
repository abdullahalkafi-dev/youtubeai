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

  REEL_RENDER_CONCURRENCY: int(2),
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
  // Pace: pauses inside clips are cut, then the reel is sped up. chipmunk = pitch rises ("Mickey Mouse" voice).
  // 1.08 plus the pause cuts is about 1.19x real speed on the host (measured); the voice itself is only time-stretched.
  REEL_SPEED: str('1.08').transform((v) => parseFloat(v)).pipe(z.number().min(1).max(1.6)),
  // energetic: pitch raise in semitones (voice character kept); ignored by chipmunk/natural.
  REEL_PITCH_SEMITONES: str('1.5').transform((v) => parseFloat(v)).pipe(z.number().min(0).max(4)),
  // natural = atempo only (pitch and voice colour untouched, the client's choice); energetic = rubberband +pitch; chipmunk = legacy.
  REEL_VOICE: z.enum(['energetic', 'chipmunk', 'natural']).default('natural'),
  REEL_TRIM_PAUSES: bool(true),
  REEL_PAUSE_MIN_GAP_MS: int(450),
  // Visual rhythm (none of these changes a clip length): punch-in on jump cuts, flash + settle (+ whoosh) at topic changes, progress line.
  REEL_FX_PUNCH: bool(true),
  REEL_FX_JOIN: bool(true),
  REEL_FX_WHOOSH: bool(true),
  REEL_FX_BAR: bool(true),
  // AI images inside reels (GPT Image). Low quality keeps each image around a cent.
  REEL_IMAGES_ENABLED: bool(true),
  REEL_IMAGE_MODEL: str('gpt-image-2.5-flare'),
  REEL_IMAGE_QUALITY: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'auto']).default('low'),
  REEL_IMAGES_MAX: int(7),
  REEL_THUMBNAILS_ENABLED: bool(true),
  /** The main app's MinIO bucket (read-only use: its subject photos, host cutouts). */
  MAIN_MINIO_BUCKET: str('thumbnails'),

  // Publishing (manual, YouTube first). Google client = the same OAuth client the main app uses.
  GOOGLE_CLIENT_ID: str(''),
  GOOGLE_CLIENT_SECRET: str(''),
  PUBLISH_CONCURRENCY: int(1),
  PUBLISH_YT_DAILY_CAP: int(10),
  PUBLISH_CHUNK_MB: int(8),
  PUBLISH_DEFAULT_PRIVACY: z.enum(['private', 'unlisted', 'public']).default('unlisted'),
  METRICS_MAX_AGE_DAYS: int(90),
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

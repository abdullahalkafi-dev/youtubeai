import { z } from 'zod';

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

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : parseFloat(v)))
    .pipe(z.number());

const str = (def: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v));

const EnvSchema = z.object({
  PORT: int(5004),

  MONGODB_URI: z.string().min(1),
  MINIO_ENDPOINT: str('minio'),
  MINIO_PORT: int(9000),
  MINIO_USE_SSL: bool(false),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),

  /** Same JWT secret as the main app and the reel service (the Podcast page uses the same login). */
  JWT_SECRET: z.string().min(1),
  /** Decrypts the YouTube cookies the reel service stores (read-only use). Empty = derived from JWT_SECRET like the reel service does. */
  REEL_SECRET_KEY: str(''),

  BUZZSPROUT_API_KEY: z.string().min(1),
  BUZZSPROUT_PODCAST_ID: str('2161138'),
  /** The "artist" shown on every episode (matches the existing episodes). */
  PODCAST_ARTIST: str('UNIQUE MECCA AUDIO'),

  /** false = the API still answers but nothing is processed. */
  PODCAST_ENABLED: bool(true),
  /** true = prepare the audio and text, save them, but send NOTHING to Buzzsprout (the episode ends as "skipped: dry run"; retry it to send it for real). */
  PODCAST_DRY_RUN: bool(false),
  /** on = the scheduler finds new YouTube videos by itself. off = only episodes added by hand are processed. */
  PODCAST_AUTO: z.enum(['on', 'off']).default('off'),
  /** ISO time: videos published before this are never auto-uploaded. Empty = the moment PODCAST_AUTO is first on (stored in podcast_settings). */
  PODCAST_AUTO_SINCE: str(''),
  /** Only the channel's own long videos: shorter ones (Shorts) are ignored. */
  PODCAST_MIN_DURATION_SEC: int(600),
  /** Empty = any channel in the shared database (there is one). */
  PODCAST_CHANNEL_ID: str(''),

  PODCAST_WORK_DIR: str('/work'),
  PODCAST_MIN_FREE_DISK_GB: int(5),
  YTDLP_BIN: str('yt-dlp'),
  FFMPEG_BIN: str('ffmpeg'),
  FFPROBE_BIN: str('ffprobe'),
  PODCAST_FFMPEG_THREADS: int(2),

  /** Silence trimming: pauses at least this long (seconds) below the noise floor are shortened. */
  PODCAST_SILENCE_MIN_SEC: num(1.5),
  PODCAST_SILENCE_DB: num(-38),
  /** How much of a cut pause is kept (seconds), split half before and half after. */
  PODCAST_SILENCE_KEEP_SEC: num(0.6),
  /** If more than this share of the episode would be removed, detection is assumed wrong and nothing is cut. */
  PODCAST_SILENCE_MAX_REMOVED: num(0.3),
  PODCAST_MP3_KBPS: int(128),

  /** Put "Watch the video on YouTube" at the top of the episode description. */
  PODCAST_YT_LINK: bool(true),
  PODCAST_MAX_TAGS: int(10),
  PODCAST_MAX_ATTEMPTS: int(4),
  /** ntfy.sh topic URL or Slack/Discord-style webhook for developer alerts (same variable the reel service uses). Empty = log only. */
  ALERT_WEBHOOK_URL: str(''),
});

export type AppConfig = z.infer<typeof EnvSchema> & { secretKey: string };

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached && env === process.env) return cached;
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid podcast-service environment: ${issues}`);
  }
  const cfg: AppConfig = { ...parsed.data, secretKey: parsed.data.REEL_SECRET_KEY || `${parsed.data.JWT_SECRET}::reel-secrets` };
  if (env === process.env) cached = cfg;
  return cfg;
}

export const CONFIG = Symbol('PODCAST_CONFIG');

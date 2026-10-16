/** Platform-agnostic publishing contracts. Only `youtube` has an adapter today; the rest are reserved. */

export const PLATFORMS = ['youtube', 'x', 'linkedin', 'instagram', 'facebook'] as const;
export type PlatformId = (typeof PLATFORMS)[number];
/** Platforms we will add later; shown in the UI as "coming soon". */
export const PLANNED_PLATFORMS: PlatformId[] = ['x', 'linkedin', 'instagram', 'facebook'];

export const POST_STATUSES = ['queued', 'uploading', 'processing', 'scheduled', 'published', 'failed', 'cancelled', 'blocked', 'removed'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];
/** Posts that still count as "this reel is already going out on this account". */
export const ACTIVE_POST_STATUSES: PostStatus[] = ['queued', 'uploading', 'processing', 'scheduled', 'published', 'blocked'];

export type Privacy = 'private' | 'unlisted' | 'public';

export interface PostMetadata {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  categoryId: string;
  privacy: Privacy;
  /** ISO timestamp. When set, the video is uploaded private and the platform makes it public at this time. */
  scheduleAt?: string | null;
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
  notifySubscribers: boolean;
}

/** Cross-platform metric names. Each platform fills what it can; `definition` records how "views" is counted. */
export interface NormalizedMetrics {
  views: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  watchMinutes?: number;
  avgViewDurationSec?: number;
  avgViewPct?: number;
  engagedViews?: number;
  subscribersGained?: number;
  impressions?: number;
  ctr?: number;
}

export interface MetricSample extends NormalizedMetrics {
  /** True when the newest numbers may still change (e.g. Reporting API days that lag 1–2 days). */
  provisional?: boolean;
  source: string;
  definition?: string;
  raw?: Record<string, unknown>;
}

export interface Issue {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export type AccountState = 'ok' | 'needs_reconnect' | 'missing';

export interface AccountStatus {
  platform: PlatformId;
  state: AccountState;
  externalId?: string;
  displayName?: string;
  handle?: string;
  message?: string;
  quota?: { usedToday: number; dailyCap: number };
}

export interface PublisherCapabilities {
  label: string;
  maxDurationSec: number;
  aspect: 'vertical' | 'vertical-or-square' | 'any';
  maxFileMB: number;
  titleMax?: number;
  descriptionMax: number;
  visibilities: Privacy[];
  supportsSchedule: boolean;
  /** `push-bytes`: we upload the file. `pull-public-url`: the platform fetches it from a public URL (Instagram/Facebook). */
  delivery: 'push-bytes' | 'pull-public-url';
  metrics: Array<keyof NormalizedMetrics>;
}

export interface PublishContext {
  filePath: string;
  fileSize: number;
  /** Saved after every chunk so a crash resumes the same upload instead of creating a duplicate. */
  saveSession: (sessionUri: string | null, bytesUploaded: number) => Promise<void>;
  /** Called between chunks; return true to abort (user cancelled). */
  shouldCancel: () => Promise<boolean>;
}

export interface PublishOutcome {
  externalId: string;
  url: string;
  warnings?: string[];
}

export interface VerifyResult {
  state: 'processing' | 'published' | 'failed';
  actualPrivacy?: Privacy;
  warnings: string[];
  error?: string;
  stats?: MetricSample;
}

export type PublishErrorKind =
  | 'auth' // token invalid / revoked / missing permission → account needs reconnect
  | 'quota' // project quota bucket exhausted → wait for reset
  | 'channel_limit' // the channel's own daily upload cap
  | 'invalid_metadata' // user must edit title/description/tags
  | 'media' // the file itself was rejected
  | 'transient' // network / 5xx → resume
  | 'cancelled'
  | 'fatal';

export class PublishError extends Error {
  constructor(
    readonly kind: PublishErrorKind,
    message: string,
    readonly code?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

/** The reel facts a publisher needs (kept small so adapters never touch our full Reel document). */
export interface ReelFacts {
  id: string;
  durationSec: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
  hasAsset: boolean;
  status: string;
  warnings: string[];
}

export interface Publisher {
  readonly platform: PlatformId;
  readonly capabilities: PublisherCapabilities;
  getAccountStatus(channelId: string): Promise<AccountStatus>;
  /** Pure checks on the reel + metadata + account; never uploads anything. */
  preflight(input: { reel: ReelFacts; metadata: PostMetadata; account: AccountStatus; hasActiveDuplicate: boolean }): Issue[];
  publish(input: { channelId: string; metadata: PostMetadata; sessionUri?: string | null; ctx: PublishContext }): Promise<PublishOutcome>;
  verify(input: { channelId: string; externalId: string; requestedPrivacy: Privacy; scheduled: boolean; ageMs: number }): Promise<VerifyResult>;
  /** Metrics for already-published posts, keyed by externalId. Missing ids simply have no sample yet. */
  collectMetrics(input: { channelId: string; externalIds: string[] }): Promise<Map<string, MetricSample | { removed: true }>>;
}

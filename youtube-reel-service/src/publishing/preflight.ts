import type { AccountStatus, Issue, PostMetadata, PublisherCapabilities, ReelFacts } from './types';
import { buildDescription, fitTags, sanitizeTitle } from './youtube-metadata';

const MIN_SCHEDULE_AHEAD_MS = 5 * 60_000;

/**
 * Pure checks, shown to the user BEFORE they confirm. Errors block publishing; warnings and info do not.
 * (Platform-neutral: the capabilities decide the limits.)
 */
export function preflightChecks(input: {
  caps: PublisherCapabilities;
  reel: ReelFacts;
  metadata: PostMetadata;
  account: AccountStatus;
  hasActiveDuplicate: boolean;
  now?: number;
}): Issue[] {
  const { caps, reel, metadata, account } = input;
  const now = input.now ?? Date.now();
  const issues: Issue[] = [];
  const err = (code: string, message: string) => issues.push({ level: 'error', code, message });
  const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message });
  const info = (code: string, message: string) => issues.push({ level: 'info', code, message });

  // Account
  if (account.state === 'needs_reconnect') err('account_reconnect', account.message || `${caps.label} needs to be reconnected.`);
  if (account.state === 'missing') err('account_missing', account.message || `No ${caps.label} account is connected.`);
  if (account.quota && account.quota.usedToday >= account.quota.dailyCap) {
    err('daily_cap', `Today's upload limit (${account.quota.dailyCap}) is reached. It resets at midnight Pacific time.`);
  }

  // The reel itself
  if (!reel.hasAsset) err('not_rendered', 'This reel has not finished rendering yet.');
  if (reel.durationSec > caps.maxDurationSec) err('too_long', `The reel is ${Math.round(reel.durationSec)}s; ${caps.label} allows at most ${caps.maxDurationSec}s.`);
  if (reel.width && reel.height) {
    const vertical = reel.height >= reel.width;
    if (caps.aspect !== 'any' && !vertical) err('not_vertical', `The video is ${reel.width}×${reel.height}. It must be vertical or square to count as a Short.`);
  }
  if (reel.sizeBytes && reel.sizeBytes > caps.maxFileMB * 1024 * 1024) err('too_large', `The file is larger than ${caps.maxFileMB} MB.`);
  for (const w of reel.warnings) warn('reel_warning', w);

  // Metadata
  if (!metadata.title.trim()) err('title_empty', 'The title is empty.');
  else if (caps.titleMax && sanitizeTitle(metadata.title) !== metadata.title.trim()) warn('title_adjusted', `The title will be cleaned or shortened to ${caps.titleMax} characters.`);
  if (!caps.visibilities.includes(metadata.privacy)) err('visibility', `${caps.label} does not support "${metadata.privacy}" visibility.`);
  if (buildDescription(metadata.description, metadata.hashtags).truncated) warn('description_truncated', 'The description is too long and will be shortened.');
  if (fitTags(metadata.tags).dropped) warn('tags_trimmed', 'Some tags will be dropped to fit the platform limit.');

  // Scheduling
  if (metadata.scheduleAt) {
    const when = new Date(metadata.scheduleAt).getTime();
    if (!caps.supportsSchedule) err('schedule_unsupported', `${caps.label} does not support scheduling here.`);
    else if (!Number.isFinite(when)) err('schedule_invalid', 'The scheduled time is not valid.');
    else if (when < now + MIN_SCHEDULE_AHEAD_MS) err('schedule_past', 'The scheduled time must be at least 5 minutes from now.');
    else info('schedule_private', 'It will be uploaded as private and switch to public automatically at the scheduled time.');
  }

  if (input.hasActiveDuplicate) err('duplicate_post', `This reel is already published (or queued) on this ${caps.label} account.`);
  if (metadata.privacy === 'public' && !metadata.scheduleAt) {
    warn('rights', 'Public posting: this reel is cut from your long videos and may contain third-party clips (news footage, music) that can draw copyright claims. Unlisted lets you check it first.');
  }
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some((i) => i.level === 'error');

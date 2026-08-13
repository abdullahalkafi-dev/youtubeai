/**
 * Build channel context string for AI prompts.
 * This is injected into system prompts to give AI awareness of channel stats.
 */
export function buildChannelContext(channel: {
  name?: string;
  handle?: string;
  subscriberCount?: number;
  totalVideos?: number;
  totalViews?: number | bigint;
  totalWatchHours?: number | bigint;
  estimatedRevenue?: number;
}): string {
  return `Channel: ${channel.name || 'Unknown'} (${channel.handle || 'N/A'})
Subscribers: ${channel.subscriberCount || 0}
Total Videos: ${channel.totalVideos || 0}
Total Views: ${Number(channel.totalViews || 0).toLocaleString()}
Total Watch Hours: ${Number(channel.totalWatchHours || 0).toLocaleString()}
Estimated Revenue: $${Number(channel.estimatedRevenue || 0).toLocaleString()}`;
}

/**
 * Build a compact channel context for token-efficient prompts.
 */
export function buildCompactChannelContext(channel: {
  name?: string;
  handle?: string;
  subscriberCount?: number;
  totalVideos?: number;
  totalViews?: number | bigint;
}): string {
  return `${channel.name || 'Unknown'} (${channel.handle || 'N/A'}) — ${(channel.subscriberCount || 0).toLocaleString()} subs, ${(channel.totalVideos || 0).toLocaleString()} videos, ${Number(channel.totalViews || 0).toLocaleString()} views`;
}

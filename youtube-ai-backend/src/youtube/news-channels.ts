/**
 * Verified news-channel allowlist for the topic footage pack (Phase 2, lite).
 *
 * Every `id` below was resolved from the live YouTube channel page
 * (`rel="canonical" href=".../channel/UC..."`) during implementation — NEVER
 * invent IDs; resolve + verify before adding.
 *
 * Usage: the allowlist FILTERS search.list results (it is not the source).
 * Denylist (own channel + competitors) is passed by the caller and always wins.
 */

export type NewsTier = 1 | 2;

export interface NewsChannel {
  /** YouTube channelId (UC…). */
  id: string;
  /** Display title at resolution time (for logs/labels only). */
  title: string;
  tier: NewsTier;
}

/** Tier 1 — newsrooms, wires, networks, local TV affiliates. */
export const TIER1_NEWS_CHANNELS: NewsChannel[] = [
  // Hosts of the 6 verdict gate videos (verified via oEmbed, Oct 2026)
  { id: 'UCVxBA3Cbu3pm8w8gEIoMEog', title: 'ABC7', tier: 1 },
  { id: 'UCSWoppsVL0TLxFQ2qP_DLqQ', title: 'NBCLA', tier: 1 },
  { id: 'UC_vFLohxs5PkAxlk7Y6jEtw', title: 'ABC 7 Chicago', tier: 1 },
  // National wires / networks / trial channels
  { id: 'UCAb6wjEu3EOzsVihpR9N1Ug', title: 'AP', tier: 1 },
  { id: 'UC8p1vwvWtl6T73JiExfWs1g', title: 'CBS News', tier: 1 },
  { id: 'UCeY0bbntWzzVIaj2z3QigXg', title: 'NBC News', tier: 1 },
  { id: 'UCBi2mrWuNuyYy4gbM6fU18Q', title: 'ABC News', tier: 1 },
  { id: 'UCXIJgqnII2ZOINSWNOGFThA', title: 'Fox News', tier: 1 },
  { id: 'UCo5E9pEhK_9kWG7-5HHcyRg', title: 'Court TV', tier: 1 },
  { id: 'UCz8K1occVvDTYDfFo7N5EZw', title: 'Law & Crime Network', tier: 1 },
  // Local affiliates (verdict/courthouse + regional case coverage)
  { id: 'UCinjnmQEwCddOudyCC1v7qA', title: 'KTLA', tier: 1 },
  { id: 'UCkH1uDkyuO9sVjSqdqBygOg', title: 'CBS Los Angeles', tier: 1 },
  { id: 'UCrlIS7z20CnVaCrMvdkig_g', title: 'ABC7 New York', tier: 1 },
  { id: 'UCxCfoSInadl-4i3F70zDt1A', title: 'NBC New York', tier: 1 },
  { id: 'UCNZyLULUQBp5e9Q1cKtvk6Q', title: 'CBS New York', tier: 1 },
  { id: 'UCgVZ0mrM3liHNhRYC5Mchgg', title: 'WPLG Local 10', tier: 1 },
  { id: 'UC0IyiKpx7Oirfbqelu3WFJA', title: 'WSVN 7News', tier: 1 },
  { id: 'UCCmpaEDV0Nzr2frEQPi_Keg', title: 'WJHG', tier: 1 },
  { id: 'UC1XaDImo77ZCHw3yU4pXlQw', title: 'WKRG', tier: 1 },
  // Verified Denver affiliates
  { id: 'UC_-gT7OYiRCK9Sp8SIv9WgQ', title: 'CBS Colorado', tier: 1 },
  { id: 'UC-2MJlKSq9_pYk5-bdvMhnw', title: 'Denver7', tier: 1 },
  { id: 'UC00SLi9yOR6iJXX-_cU2APg', title: '9NEWS', tier: 1 },
  { id: 'UCaoDaJH-Ji_NBpQOn5aeX7A', title: 'FOX31 Denver', tier: 1 },
];

/** Tier 2 — verified urban/hip-hop news outlets. Fallback only, ≤3 per pack, labeled. */
export const TIER2_NEWS_CHANNELS: NewsChannel[] = [
  { id: 'UC0KfHrqdI1sWILqSBQTALGA', title: 'SAY CHEESE!', tier: 2 },
  { id: 'UCQ-LVQJtazs4a2CtZHHjsqg', title: 'The Neighborhood Talk', tier: 2 },
];

const ALLOWED: Map<string, NewsChannel> = new Map(
  [...TIER1_NEWS_CHANNELS, ...TIER2_NEWS_CHANNELS].map((c) => [c.id, c]),
);

export function getAllowedChannel(channelId: string): NewsChannel | undefined {
  return ALLOWED.get(channelId);
}

export function isAllowedChannel(channelId: string): boolean {
  return ALLOWED.has(channelId);
}

export function isTier1AllowedChannel(channelId: string): boolean {
  return ALLOWED.get(channelId)?.tier === 1;
}

export function isTier2AllowedChannel(channelId: string): boolean {
  return ALLOWED.get(channelId)?.tier === 2;
}

/**
 * Titles that look like commentary/opinion — skipped even on allowed channels
 * (usable B-roll is reported footage, not reaction content).
 */
export const COMMENTARY_TITLE_SKIP =
  /\b(reaction|reacts?|reacting|breakdown|explained|responds?|reviews?|opinion|commentary|my take)\b/i;

/**
 * Strict anti-reaction & commentary filter for raw celebrity B-roll clips.
 * Drops talking heads, drama channels, video essays, podcasts, and react streamers.
 */
export const BROLL_REACTION_TITLE_SKIP =
  /\b(reaction|reacts?|reacting|breakdown|commentary|opinion|review|responds?|explained|thoughts on|drama|tea|exposed|podcast|interview with|why he|why she|what happened to|my take|streamer|stream|talks about|exposes?|analysis|documentary|deep dive)\b/i;

/**
 * Strict case-sensitive regex for broadcast stations.
 * - Supports CBS News <Capitalized city> (e.g. CBS News Colorado, CBS News Chicago)
 * - Allows digits without spaces (FOX31, ABC7, NBC 5)
 * - Negative lookahead prevents national branches and bare network news from matching
 */
export const LOCAL_STATION_REGEX =
  /\bCBS\s+News\s+[A-Z][a-z]+\b|\b(?:NBC|CBS|ABC|FOX|CW|PBS)\s*(?:\d{1,2}|(?!(?:Sports|Kids|Entertainment|Studios|Learning|Network|Classics|Music|Nation|Fan|Olympics|Now|News)\b)[A-Z][a-z]+(?:\s*(?:News|Action|Live|\d{1,2}))?)\b|\b(?:Channel\s*\d{1,2}|Local\s*\d{1,2}|Action\s*News|Eyewitness\s*News)\b|\b\d{1,2}\s*(?:News|NEWS|Action|Live|Alive)\b|\b\d{1,2}NEWS\b|\b(?!(?:Sports|Kids|Entertainment|Studios|Learning|Network|Classics|Music|Nation|Fan|Olympics|Now|News|Week)\b)[A-Z][a-z]+\d{1,2}\b/;

/**
 * Broadcast call signs: anchored to suffixed patterns or title-start patterns.
 */
export const BROADCAST_CALLSIGN_REGEX =
  /\b[KW][A-Z]{2,3}(?:[- ]?TV|\s+News|\s*\d{1,2})\b|^[KW][A-Z]{2,3}\s+(?:News|Action|Live|TV|\d{1,2})\b/;

export const CALLSIGN_STOPLIST = new Set([
  'WNBA', 'WWE', 'WION', 'WOW', 'WTF', 'KIDS', 'WHAT', 'WITH', 'WHEN', 'WEEK',
  'WILL', 'WELL', 'WEST', 'WILD', 'WENT', 'WERE', 'WARN', 'WORD', 'KEEP', 'KILL',
  'KNOW', 'KIND', 'KING', 'WIFE', 'WINS', 'KEYS', 'WALK', 'WASH', 'WAVE', 'WIND',
  'WIRE', 'WISH', 'WOOD', 'WORK', 'WAIT', 'WAR', 'WANT', 'WIDE', 'WAYS', 'WOKE',
]);

export function isLikelyBroadcastStation(channelTitle: string): boolean {
  if (!channelTitle) return false;
  const trimmed = channelTitle.trim();
  if (LOCAL_STATION_REGEX.test(trimmed)) return true;
  if (BROADCAST_CALLSIGN_REGEX.test(trimmed)) {
    const token = trimmed.split(/[\s-]+/)[0].toUpperCase();
    if (CALLSIGN_STOPLIST.has(token)) return false;
    return true;
  }
  return false;
}

/** Honest provenance labels */
export const TIER1_LABEL = 'verified newsroom';
export const TIER2_LABEL = 'urban news outlet';
export const LIKELY_LOCAL_LABEL = 'likely local station';
export const BROLL_LABEL = 'contextual B-roll';


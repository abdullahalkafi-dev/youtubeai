/**
 * Episode text from the YouTube video's own metadata (pure functions). The video already carries the finished SEO text the main app wrote
 * (summary, bullets, a "CHAPTERS" block, series links, hashtags) and its tags; the episode reuses them. Only the chapter timestamps change,
 * because trimming silence moves every later moment earlier.
 */
import { formatClock } from './silence';

export interface YtVideo {
  youtubeId: string;
  title: string;
  description?: string | null;
  tags?: string[] | null;
}

export interface Chapter {
  /** Seconds in the trimmed audio. */
  startSec: number;
  title: string;
}

export interface EpisodeMeta {
  title: string;
  descriptionHtml: string;
  tags: string;
  chapters: Chapter[];
}

const CHAPTER_LINE = /^(\s*)(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(\s*(?:[-–—:|]\s*)?)(.+?)\s*$/;

interface ParsedLine {
  index: number;
  sec: number;
  prefix: string;
  sep: string;
  title: string;
}

/** The first block of at least 3 consecutive "m:ss Title" lines that starts at 0:00 (how YouTube chapters are written). */
export function findChapterBlock(lines: string[]): ParsedLine[] {
  let block: ParsedLine[] = [];
  const flush = (): ParsedLine[] | null => (block.length >= 3 && block[0].sec === 0 ? block : null);
  for (let i = 0; i < lines.length; i++) {
    const m = CHAPTER_LINE.exec(lines[i]);
    if (m) {
      const sec = (m[2] ? parseInt(m[2], 10) * 3600 : 0) + parseInt(m[3], 10) * 60 + parseInt(m[4], 10);
      const prev = block[block.length - 1];
      if (prev && sec <= prev.sec) {
        const done = flush();
        if (done) return done;
        block = [];
      }
      block.push({ index: i, sec, prefix: m[1], sep: m[5] || ' ', title: m[6] });
    } else if (lines[i].trim() === '' && block.length === 0) {
      continue;
    } else {
      const done = flush();
      if (done) return done;
      block = [];
    }
  }
  return flush() ?? [];
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain text -> the HTML Buzzsprout stores: escaped, links clickable, one <br> per line break, wrapped in <p>. */
export function textToHtml(text: string): string {
  const body = escapeHtml(text.trim())
    .replace(/(https?:\/\/[^\s<]+)/g, (url) => {
      const trail = /[).,;!?]+$/.exec(url)?.[0] ?? '';
      const clean = trail ? url.slice(0, -trail.length) : url;
      return `<a href="${clean}">${clean}</a>${trail}`;
    })
    .replace(/\r?\n/g, '<br>');
  return `<p>${body}</p>`;
}

export function buildTags(tags: string[] | null | undefined, max: number): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const t = raw.replace(/[,\r\n]+/g, ' ').trim();
    if (!t || t.length > 60 || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= max) break;
  }
  return out.join(', ');
}

export interface BuildOptions {
  /** Moment in the original video -> moment in the trimmed audio. */
  mapTime: (sec: number) => number;
  /** Length of the trimmed audio; chapters at or after it are dropped. */
  durationSec: number;
  maxTags: number;
  youtubeLink: boolean;
}

export function buildEpisodeMeta(video: YtVideo, opts: BuildOptions): EpisodeMeta {
  const lines = (video.description ?? '').replace(/\r\n?/g, '\n').split('\n');
  const block = findChapterBlock(lines);

  const chapters: Chapter[] = [];
  for (const c of block) {
    const startSec = Math.round(opts.mapTime(c.sec));
    const last = chapters[chapters.length - 1];
    if (startSec >= opts.durationSec - 1) continue;
    if (last && startSec <= last.startSec) continue;
    chapters.push({ startSec, title: c.title });
  }
  // Rewrite the timestamps in the text so the description matches the trimmed audio.
  const rewritten = [...lines];
  for (const c of block) rewritten[c.index] = `${c.prefix}${formatClock(opts.mapTime(c.sec))}${c.sep}${c.title}`;

  let text = rewritten.join('\n').trim();
  if (opts.youtubeLink) text = `▶️ Watch the video version on YouTube: https://youtu.be/${video.youtubeId}\n\n${text}`;
  const title = (video.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 250);
  return { title, descriptionHtml: textToHtml(text), tags: buildTags(video.tags, opts.maxTags), chapters };
}

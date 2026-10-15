import type { ReelWord } from '../db/schemas/reel.schema';
import type { ReelTemplate } from './template';

/** "#RRGGBB" -> ASS "&H00BBGGRR" */
export function assColor(hex: string, alpha = 0): string {
  const h = hex.replace('#', '').padEnd(6, '0');
  const rr = h.slice(0, 2);
  const gg = h.slice(2, 4);
  const bb = h.slice(4, 6);
  const aa = alpha.toString(16).padStart(2, '0');
  return `&H${aa}${bb}${gg}${rr}`.toUpperCase();
}

function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const cs = Math.round((s - h * 3600 - m * 60) * 100);
  const ss = Math.floor(cs / 100);
  const frac = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(frac).padStart(2, '0')}`;
}

/** Strip ASS control characters so spoken text can never inject override tags. */
export function assEscape(text: string): string {
  return text.replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim();
}

function cleanWord(w: string, uppercase: boolean): string {
  const t = assEscape(w).replace(/^[,;:]+|[,;:]+$/g, '');
  return uppercase ? t.toUpperCase() : t;
}

export interface CaptionChunk {
  start: number;
  end: number;
  words: ReelWord[];
}

/** Group words into short on-screen chunks: break on sentence end, pauses, word and char limits. */
export function chunkWords(words: ReelWord[], maxWords: number, maxChars: number): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  let cur: ReelWord[] = [];
  const flush = () => {
    if (cur.length) chunks.push({ start: cur[0].s, end: cur[cur.length - 1].e, words: cur });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const chars = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
      if (cur.length >= maxWords || chars > maxChars || prev.eos || w.s - prev.e > 0.45) flush();
    }
    cur.push(w);
  }
  flush();
  // Extend each chunk until the next one starts (no flicker), but never more than 0.6 s past its last word.
  for (let i = 0; i < chunks.length; i++) {
    const next = chunks[i + 1];
    const hold = chunks[i].end + 0.6;
    chunks[i].end = next ? Math.min(next.start, hold) : hold;
  }
  return chunks;
}

/** Greedy word wrap; shrinks the font until the headline fits in maxLines. */
export function layoutHeadline(text: string, tpl: ReelTemplate['headline']): { lines: string[]; size: number } {
  const clean = assEscape(tpl.uppercase ? text.toUpperCase() : text);
  let size = tpl.size;
  while (size >= tpl.minSize) {
    const maxChars = Math.max(6, Math.floor(tpl.maxWidth / (size * tpl.charWidth)));
    const lines = wrap(clean, maxChars);
    if (lines.length <= tpl.maxLines) return { lines, size };
    size = Math.floor(size * 0.92);
  }
  const maxChars = Math.max(6, Math.floor(tpl.maxWidth / (tpl.minSize * tpl.charWidth)));
  return { lines: wrap(clean, maxChars).slice(0, tpl.maxLines), size: tpl.minSize };
}

/** Word wrap; when the text needs exactly two lines, split where the two lines are most even. */
function wrap(text: string, maxChars: number): string[] {
  const greedy = greedyWrap(text, maxChars);
  if (greedy.length !== 2) return greedy;
  const words = text.split(' ').filter(Boolean);
  let best = greedy;
  let bestLongest = Math.max(...greedy.map((l) => l.length));
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const longest = Math.max(a.length, b.length);
    if (longest <= maxChars && longest < bestLongest) {
      best = [a, b];
      bestLongest = longest;
    }
  }
  return best;
}

function greedyWrap(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ').filter(Boolean)) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= maxChars) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function buildAss(input: { words: ReelWord[]; headline: string | null; template: ReelTemplate; duration: number }): string {
  const { template: t } = input;
  const cap = t.captions;
  const hl = t.headline;
  const out: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${t.width}`,
    `PlayResY: ${t.height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,${cap.font},${cap.size},${assColor(cap.color)},${assColor(cap.color)},${assColor(cap.outlineColor)},${assColor('#000000', 0x80)},0,0,0,0,100,100,0,0,1,${cap.outline},${cap.shadow},5,40,40,0,1`,
    `Style: Headline,${hl.font},${hl.size},${assColor(hl.color)},${assColor(hl.color)},${assColor(hl.outlineColor)},${assColor('#000000', 0x80)},0,0,0,0,100,100,1,0,1,${hl.outline},0,8,40,40,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  if (hl.enabled && input.headline?.trim()) {
    const { lines, size } = layoutHeadline(input.headline, hl);
    out.push(
      `Dialogue: 2,${assTime(0)},${assTime(input.duration + 0.5)},Headline,,0,0,0,,{\\an8\\pos(${hl.centerX},${hl.top})\\fs${size}}${lines.join('\\N')}`,
    );
  }

  if (cap.enabled && input.words.length) {
    const hi = assColor(cap.highlightColor);
    const base = assColor(cap.color);
    for (const chunk of chunkWords(input.words, cap.maxWordsPerChunk, cap.maxCharsPerChunk)) {
      const tokens = chunk.words.map((w) => cleanWord(w.w, cap.uppercase));
      if (!tokens.some(Boolean)) continue;
      chunk.words.forEach((w, i) => {
        const start = i === 0 ? chunk.start : w.s;
        const end = i === chunk.words.length - 1 ? chunk.end : chunk.words[i + 1].s;
        if (end - start < 0.02) return;
        const text = tokens
          .map((tok, j) => (j === i ? `{\\c${hi}\\fscx108\\fscy108}${tok}{\\c${base}\\fscx100\\fscy100}` : tok))
          .filter(Boolean)
          .join(' ');
        out.push(`Dialogue: 1,${assTime(start)},${assTime(end)},Caption,,0,0,0,,{\\an5\\pos(${cap.centerX},${cap.centerY})}${text}`);
      });
    }
  }
  return out.join('\n') + '\n';
}

/** Plain SRT for download / platform upload. */
export function buildSrt(words: ReelWord[]): string {
  const groups: ReelWord[][] = [];
  let cur: ReelWord[] = [];
  for (const w of words) {
    const chars = cur.reduce((n, x) => n + x.w.length + 1, 0);
    if (cur.length && (cur.length >= 8 || chars + w.w.length > 42 || cur[cur.length - 1].eos)) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  const ts = (sec: number) => assTime(sec).replace(/^(\d+):(\d\d):(\d\d)\.(\d\d)$/, (_m, h, m, s, c) => `${String(h).padStart(2, '0')}:${m}:${s},${c}0`);
  return (
    groups
      .map((g, i) => `${i + 1}\n${ts(g[0].s)} --> ${ts(g[g.length - 1].e)}\n${g.map((w) => assEscape(w.w)).join(' ')}\n`)
      .join('\n') + '\n'
  );
}

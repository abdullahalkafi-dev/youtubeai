import { RecentTwist } from '../openai/prompts/unique-persona';

/** Strips list/rail markup and bold markers from one spoken line. */
function plainLine(line: string): string {
  return line
    .replace(/^\s*>\s*/, '')
    .replace(/^\s*[-•*]\s+/, '')
    .replace(/\*\*/g, '')
    .trim();
}

/**
 * Reads the point-2 title and first spoken lines of a saved full script (not the bullet script).
 * Returns null when the message is not a script or has no point 2.
 */
export function extractTwist(content: string): RecentTwist | null {
  if (!content || !content.includes('<!-- SCRIPT_START -->')) return null;
  const start = content.indexOf('<!-- SCRIPT_START -->');
  const end = content.indexOf('<!-- SCRIPT_END -->', start);
  const body = content.slice(start, end === -1 ? undefined : end);
  const lines = body.split('\n');
  const idx = lines.findIndex((l) => /^##\s+\**\s*2\s*[.)]/.test(l.trim()));
  if (idx === -1) return null;
  const title = plainLine(lines[idx].replace(/^##\s+/, '').replace(/^\**\s*2\s*[.)]\s*/, '')).slice(0, 90);
  const spoken: string[] = [];
  for (let i = idx + 1; i < lines.length && spoken.length < 2; i++) {
    const t = lines[i].trim();
    if (/^#{1,3}\s/.test(t)) break;
    if (t.startsWith('>')) {
      const p = plainLine(t);
      if (p) spoken.push(p);
    }
  }
  if (!title && !spoken.length) return null;
  return { title, opening: spoken.join(' ').slice(0, 160) };
}

/** The twists of the most recent scripts in a thread, newest first. */
export function extractRecentTwists(
  messages: Array<{ role: string; content: string }>,
  max: number = 3,
): RecentTwist[] {
  const out: RecentTwist[] = [];
  for (let i = messages.length - 1; i >= 0 && out.length < max; i--) {
    const m = messages[i];
    if (m.role !== 'assistant') continue;
    const t = extractTwist(m.content);
    if (t) out.push(t);
  }
  return out;
}

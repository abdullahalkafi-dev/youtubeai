/**
 * YouTube link helpers for chat markdown.
 * Collapse duplicate playable cards without touching Sources extraction
 * (Sources parse the raw message separately).
 */

export function extractYouTubeId(url: string): string | null {
  if (!url) return null
  // youtu.be/ID | youtube.com/watch?v=ID | watch?foo&v=ID | embed/ | v/ | shorts/ | m./www. host
  const regExp =
    /(?:youtu\.be\/|(?:www\.|m\.)?youtube\.com\/(?:embed\/|v\/|shorts\/|watch\?(?:[^)\s#]*&)?v=))([\w-]{11})/i
  const match = url.match(regExp)
  return match && match[1].length === 11 ? match[1] : null
}

function isWeakTitle(title: string | undefined): boolean {
  if (!title) return true
  const t = title.trim()
  if (!t) return true
  if (/^https?:\/\//i.test(t)) return true
  if (t.includes('](') || t.includes('![') || t.includes('http')) return true
  if (/^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)(?:\/\S*)?$/i.test(t)) return true
  return false
}

function scoreOccurrence(
  kind: 'image-link' | 'md-link' | 'bare',
  title?: string,
  afterText?: string,
): number {
  if (kind === 'bare') return 1
  if (isWeakTitle(title)) return 2
  let score = 10 + Math.min(title!.trim().length, 80)
  // Give high priority to rich verified clips (containing duration & view count)
  if (afterText && /\s*[—–-]\s*[\d:]+\s*\|\s*[\d,]+\s*views/i.test(afterText.slice(0, 80))) {
    score += 100
  }
  return score
}

/** True if index sits inside a markdown link href `]( ... )` — do not bare-dedupe those. */
function isInsideMarkdownHref(text: string, index: number): boolean {
  const before = text.slice(0, index)
  const hrefOpen = before.lastIndexOf('](')
  if (hrefOpen === -1) return false
  return !before.includes(')', hrefOpen + 2)
}

type Occurrence = {
  wrapStart: number
  wrapEnd: number
  id: string
  score: number
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = [[sorted[0][0], sorted[0][1]]]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const cur = sorted[i]
    if (cur[0] <= last[1]) last[1] = Math.max(last[1], cur[1])
    else out.push([cur[0], cur[1]])
  }
  return out
}

/**
 * Keep the best playable link per video ID (prefer real titles over
 * [youtube.com](url) / bare URLs). Pure string preprocess — StrictMode-safe.
 * Idempotent: safe to run on full message and again per markdown block.
 */
export function collapseDuplicateYouTubeCards(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') return markdown

  const occs: Occurrence[] = []
  const add = (id: string, score: number, wrapStart: number, wrapEnd: number) => {
    if (wrapEnd > wrapStart) occs.push({ id, score, wrapStart, wrapEnd })
  }

  // 1) Image-in-link: [![alt](thumb)](youtube-url) — optional wrapping parens
  const imageLinkRe = /(?:\(\s*)?\[!\[([^\]]*)\]\([^)]*\)\]\((https?:\/\/[^)\s]+)\)(?:\s*\))?/g
  let m: RegExpExecArray | null
  while ((m = imageLinkRe.exec(markdown)) !== null) {
    const id = extractYouTubeId(m[2])
    if (!id) continue
    add(id, scoreOccurrence('image-link', m[1]), m.index, m.index + m[0].length)
  }

  // 2) Markdown links: [text](url) — one nested [] in text; optional wrapping parens
  const mdLinkRe = /(?:\(\s*)?\[((?:[^\[\]]|\[[^\]]*\])*)\]\((https?:\/\/[^)\s]+)\)(?:\s*\))?/g
  while ((m = mdLinkRe.exec(markdown)) !== null) {
    const id = extractYouTubeId(m[2])
    if (!id) continue
    const title = m[1]
    // Image-in-link matches as a giant "title" — score like a weak label
    const kind = title.startsWith('![') || title.includes('](') ? 'image-link' : 'md-link'
    const afterText = markdown.slice(m.index + m[0].length)
    add(id, scoreOccurrence(kind, title, afterText), m.index, m.index + m[0].length)
  }

  // 3) Bare / www / m URLs not already inside a markdown href
  const bareRe =
    /(?<!\]\()(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^)\s#]*&)?v=|embed\/|v\/|shorts\/)[\w-]{11}|youtu\.be\/[\w-]{11})(?![\w-])/gi
  while ((m = bareRe.exec(markdown)) !== null) {
    const match = m
    const id = extractYouTubeId(match[0])
    if (!id) continue
    if (isInsideMarkdownHref(markdown, match.index)) continue
    const insideExisting = occs.some(
      (o) => match.index >= o.wrapStart && match.index + match[0].length <= o.wrapEnd,
    )
    if (insideExisting) continue
    add(id, scoreOccurrence('bare'), match.index, match.index + match[0].length)
  }

  // Best occurrence per video ID (higher score wins; ties → earlier)
  const best = new Map<string, Occurrence>()
  for (const o of occs) {
    const prev = best.get(o.id)
    if (!prev || o.score > prev.score || (o.score === prev.score && o.wrapStart < prev.wrapStart)) {
      best.set(o.id, o)
    }
  }

  const keep = occs.filter((o) => best.get(o.id) === o)
  const drop = occs
    .filter((o) => best.get(o.id) !== o)
    // never cut a span that overlaps a kept winner
    .filter((o) => !keep.some((k) => !(o.wrapEnd <= k.wrapStart || o.wrapStart >= k.wrapEnd)))

  const cuts = mergeRanges(
    drop.map((o) => {
      let start = o.wrapStart
      let end = o.wrapEnd

      // Expand to clean whole line if this link sits inside a list item with metadata
      const lineStart = markdown.lastIndexOf('\n', start - 1) + 1
      let lineEnd = markdown.indexOf('\n', end)
      if (lineEnd === -1) lineEnd = markdown.length

      const before = markdown.slice(lineStart, start)
      const after = markdown.slice(end, lineEnd)

      const isListPrefix = /^\s*(?:\d+[\.\)]|\*|-)?\s*$/.test(before)
      const isMetaOrEmpty = /^\s*(?:[—–-]\s*[\d:]+\s*\|\s*[\d,]+\s*views.*)?\s*$/i.test(after)

      if (isListPrefix && isMetaOrEmpty) {
        const expandedStart = lineStart
        const expandedEnd = lineEnd + (markdown[lineEnd] === '\n' ? 1 : 0)
        // Ensure expanded range never touches a kept winner
        if (!keep.some((k) => !(expandedEnd <= k.wrapStart || expandedStart >= k.wrapEnd))) {
          start = expandedStart
          end = expandedEnd
        }
      }

      return [start, end] as [number, number]
    }),
  )
  let out = ''
  let cursor = 0
  for (const [start, end] of cuts) {
    out += markdown.slice(cursor, start)
    cursor = end
  }
  out += markdown.slice(cursor)

  // Empty parens left after removing ([youtube.com](url)) or (url)
  out = out.replace(/\(\s*\)/g, '')
  // Dangling open paren before a blank line where the second card used to sit
  out = out.replace(/\(\s*\n/g, '\n')
  return out
}

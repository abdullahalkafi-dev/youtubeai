export type ContentType = 'seo' | 'thumbnail' | 'ideas' | 'trends' | 'script' | 'outline' | 'image' | 'markdown' | 'modular_package' | 'composite'

export interface SeoContent {
  title: string
  description: string
  tags: string[]
  hashtags: string[]
}

export interface ThumbnailConcept {
  text: string
  visual: string
  colors: string
}

export interface SceneConcept {
  scene: string
  style: string
  colors: string
  textOverlay?: string
}

export interface IdeaScore {
  score: string
  status: 'greenlight' | 'hold' | 'pass'
  criteria: Array<{ name: string; score: string; reason: string }>
  improvements: string[]
}

export interface TrendItem {
  title: string
  summary: string
  opportunityScore: string
  recommendation: string
  contentAngle: string
  whyNow: string
}

export type ContentBlock =
  | { type: 'markdown'; content: string }
  | { type: 'thumbnail'; thumbnails: ThumbnailConcept[]; raw?: string }
  | { type: 'scene'; sceneConcepts: SceneConcept[]; raw?: string }
  | { type: 'seo'; seo: SeoContent; raw?: string }
  | { type: 'ideas'; ideaScore: IdeaScore; raw?: string }
  | { type: 'script'; scriptContent: string; raw?: string }
  | { type: 'trends'; trends: TrendItem[]; raw?: string }
  | { type: 'outline'; content: string; raw?: string }

export interface ParsedContent {
  type: ContentType
  raw: string
  blocks?: ContentBlock[]
  seo?: SeoContent
  thumbnails?: ThumbnailConcept[]
  sceneConcepts?: SceneConcept[]
  ideaScore?: IdeaScore
  trends?: TrendItem[]
  sources?: Array<{ title: string; url: string }>
  preamble?: string
  teleprompterScript?: string
  postamble?: string
}

export function stripScriptDelimiters(text: string): string {
  if (!text) return ''
  return text.replace(/<!--\s*SCRIPT_(?:START|END)\s*-->|<<<\/?SCRIPT_(?:START|END)>>>/gi, '').trim()
}

export function stripThumbnailDelimiters(text: string): string {
  if (!text) return ''
  return text.replace(/<!--\s*THUMBNAILS_(?:START|END)\s*-->|<<<\/?THUMBNAILS_(?:START|END)>>>/gi, '').trim()
}

function extractSources(content: string): Array<{ title: string; url: string }> {
  const sources: Array<{ title: string; url: string }> = []
  const seen = new Set<string>()

  // Match markdown links: [title](url)
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
  let match
  while ((match = linkRegex.exec(content)) !== null) {
    if (!seen.has(match[2])) {
      seen.add(match[2])
      sources.push({ title: match[1], url: match[2] })
    }
  }

  // Match bare URLs in SOURCES section
  const sourcesMatch = content.match(/## Sources[\s\S]*$/i)
  if (sourcesMatch) {
    const urlRegex = /(https?:\/\/[^\s)\]>]+)/g
    const lines = sourcesMatch[0].split('\n')
    for (const line of lines) {
      while ((match = urlRegex.exec(line)) !== null) {
        const url = match[1].replace(/[.,;:!?)]+$/, '')
        if (!seen.has(url)) {
          seen.add(url)
          // Try to extract title from line
          const titleMatch = line.match(/\d+\.\s*(.+?)(?:\s*https?|$)/)
          let title = titleMatch?.[1]?.trim()
          if (!title) {
            try { title = new URL(url).hostname } catch { title = url }
          }
          sources.push({ title, url })
        }
      }
      urlRegex.lastIndex = 0
    }
  }

  return sources
}

function extractSection(content: string, header: string): string {
  const regex = new RegExp(`## ${header}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'i')
  const match = content.match(regex)
  return match?.[1]?.trim() || ''
}

function parseSeoContent(content: string): SeoContent | null {
  let title = extractSection(content, 'Title')
  const description = extractSection(content, 'Description')
  const tagsRaw = extractSection(content, 'Tags')
  const hashtagsRaw = extractSection(content, 'Hashtags')

  if (!title && !description) return null

  // Sanitize title from markdown formatting like **Title** or "Title"
  title = title
    .replace(/^[\*\#\"\']+|[\*\#\"\']+$/g, '')
    .replace(/\*\*/g, '')
    .trim()

  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : []
  const hashtags = hashtagsRaw ? hashtagsRaw.split(/[\s,]+/).map(h => h.replace(/^#/, '').trim()).filter(Boolean) : []

  return { title, description, tags, hashtags }
}

function parseThumbnailContent(content: string): ThumbnailConcept[] | null {
  const cleanContent = stripThumbnailDelimiters(content)
  const concepts: ThumbnailConcept[] = []

  // Pattern A: Standard Concept headers (e.g. ### Concept 1, Concept 1 — Best Pick, **Concept 1**, 1. "TITLE")
  const conceptRegex = /(?:^|\n)(?:#{1,3}\s*)?(?:\*{0,2}(?:Concept\s*#?\d+|Thumbnail\s*Concept(?:\s*#?\d+)?|\d+\.\s*Concept(?:\s*#?\d+)?)\*{0,2}[^\n]*)\n([\s\S]*?)(?=(?:\n|^)(?:#{1,3}\s*)?(?:\*{0,2}(?:Concept\s*#?\d+|Thumbnail\s*Concept|\d+\.\s*Concept)\*{0,2})|---|\n\n(?:\*{0,2}(?:Best Pick|My Recommendation|Recommendation|Why this|Note):?)|$)/gi
  let match
  while ((match = conceptRegex.exec(cleanContent)) !== null) {
    const section = match[1] || match[0]

    // Extract text overlay (handles single line or multiline)
    let text = ''
    const textHeaderRegex = /(?:\*\*Text overlay:\*\*|\*\*Headline Text:\*\*|Thumbnail Text:|Headline Text:|Headline:|Text overlay:|Title Text:|Text:)/i
    const textHeaderMatch = section.match(textHeaderRegex)
    if (textHeaderMatch && textHeaderMatch.index !== undefined) {
      const afterHeader = section.slice(textHeaderMatch.index + textHeaderMatch[0].length)
      const firstLine = afterHeader.split('\n')[0].trim()
      if (firstLine.length > 0) {
        text = firstLine
      } else {
        const remainingLines = afterHeader.trimStart().split('\n')
        const collected: string[] = []
        for (const line of remainingLines) {
          const trimmedLine = line.trim()
          if (!trimmedLine) break
          if (/^(?:\*{0,2}Visual|Visual concept|Visual hook|Color|Why it clicks|AI)/i.test(trimmedLine)) break
          collected.push(trimmedLine.replace(/^[-*•\s]+/, ''))
        }
        text = collected.join(' / ')
      }
    }
    text = text.replace(/[\*\"\“\”\']+/g, '').trim()

    // Extract visual concept
    const visualMatch = section.match(/(?:\*\*Visual concept:\*\*|Visual Concept:|Visual Hook:|Visual:|Visual concept:|Visual Layout\s*(?:—|-)\s*16:9:?)\s*([\s\S]*?)(?=\n\s*(?:Composition:|Color Strategy:|Color scheme:|Why [iI]t [cC]licks:|AI \/ Designer Prompt:|Image Prompt:|\*\*Color scheme:\*\*|$))/i)
      || section.match(/(?:AI \/ Designer Prompt:|AI Prompt:|Image Prompt:)\s*(.+)/i)
    const visual = visualMatch?.[1]?.replace(/\*\*/g, '').trim() || ''

    // Extract color scheme
    const colorMatch = section.match(/(?:\*\*Color scheme:\*\*|Color Strategy:|Colors:|Color scheme:)\s*([\s\S]*?)(?=\n\s*(?:Why [iI]t [cC]licks:|AI \/ Designer Prompt:|Image Prompt:|$))/i)
    const colors = colorMatch?.[1]?.replace(/\*\*/g, '').trim() || ''

    if (text || visual) {
      concepts.push({ text, visual, colors })
    }
  }

  // Fallback: If not partitioned into sections but contains explicit thumbnail keys
  if (concepts.length === 0) {
    const textMatches = Array.from(cleanContent.matchAll(/(?:Thumbnail Text:|Text overlay:|Thumbnail Concept:\s*["“]?([^"\n\r”]+)["”]?)\s*(.+)?/gi))
    const visualMatches = Array.from(cleanContent.matchAll(/(?:Visual Hook:|Visual concept:|Visual Layout\s*(?:—|-)\s*16:9:?|AI \/ Designer Prompt:|Image Prompt:)\s*(.+)/gi))
    for (let i = 0; i < Math.max(textMatches.length, visualMatches.length); i++) {
      const text = textMatches[i]?.[1] || textMatches[i]?.[2]?.replace(/\*\*/g, '').trim() || ''
      const visual = visualMatches[i]?.[1]?.replace(/\*\*/g, '').trim() || ''
      if (text || visual) {
        concepts.push({ text, visual, colors: '' })
      }
    }
  }

  // Fallback B: Single thumbnail concept format (e.g. ## THUMBNAIL TEXT followed by **HEADLINE** and Visual concept)
  if (concepts.length === 0 && /\bTHUMBNAIL\b/i.test(cleanContent) && /(?:Visual concept:|Visual:|Visual Hook:)/i.test(cleanContent)) {
    const singleTextMatch = cleanContent.match(/(?:THUMBNAIL\s*(?:TEXT|CONCEPT)?\b[^\n]*\n+)?\*\*([^\*\n]+)\*\*/i)
    const singleVisualMatch = cleanContent.match(/(?:Visual concept:|Visual Hook:|Visual:)\s*([\s\S]*?)(?=\n\s*(?:Color scheme:|Colors:|Why [iI]t [cC]licks:|##|$))/i)
    const singleColorMatch = cleanContent.match(/(?:Color scheme:|Colors:)\s*([\s\S]*?)(?=\n\s*(?:Why [iI]t [cC]licks:|##|$))/i)
    if (singleTextMatch || singleVisualMatch) {
      concepts.push({
        text: singleTextMatch?.[1]?.trim() || '',
        visual: singleVisualMatch?.[1]?.replace(/\*\*/g, '').trim() || '',
        colors: singleColorMatch?.[1]?.replace(/\*\*/g, '').trim() || '',
      })
    }
  }

  return concepts.length > 0 ? concepts : null
}

function parseSceneConcepts(content: string): SceneConcept[] | null {
  const concepts: SceneConcept[] = []
  const conceptRegex = /(?:###\s*Scene\s*Concept\s*\d+|###\s*Scene\s*\d+|###\s*Background\s*Visual\s*Concept)\s*\n([\s\S]*?)(?=(?:###\s*Scene\s*Concept|###\s*Scene\s*\d+|###\s*Background|###|$))/gi
  let match
  while ((match = conceptRegex.exec(content)) !== null) {
    const section = match[1]
    const scene = section.match(/(?:\*\*Scene:\*\*|Scene:|Visual Layout\s*(?:—|-)\s*16:9:?)\s*(.+)/i)?.[1]?.trim() || ''
    const style = section.match(/(?:\*\*Style:\*\*|Style:)\s*(.+)/i)?.[1]?.trim() || ''
    const colors = section.match(/(?:\*\*Colors:\*\*|Colors:)\s*(.+)/i)?.[1]?.trim() || ''
    const textOverlay = section.match(/(?:\*\*Text overlay.*:\*\*|Text overlay.*:)\s*(.+)/i)?.[1]?.trim() || ''
    if (scene || style) concepts.push({ scene, style, colors, textOverlay })
  }

  // Fallback for single scene / background picture prompt
  if (concepts.length === 0 && (/\b(?:scene|background.*picture|visual layout|cinematic.*prompt|b.?roll)\b/i.test(content))) {
    const scene = content.match(/(?:\*\*Scene:\*\*|Scene:|Visual Layout\s*(?:—|-)\s*16:9:?|Prompt:|\*\*Prompt:\*\*)\s*([^\n\r]+)/i)?.[1]?.trim() || ''
    const style = content.match(/(?:\*\*Style:\*\*|Style:)\s*([^\n\r]+)/i)?.[1]?.trim() || ''
    const colors = content.match(/(?:\*\*Colors:\*\*|Colors:)\s*([^\n\r]+)/i)?.[1]?.trim() || ''
    const textOverlay = content.match(/(?:\*\*Text overlay.*:\*\*|Text overlay.*:)\s*([^\n\r]+)/i)?.[1]?.trim() || ''
    if (scene || style) concepts.push({ scene, style, colors, textOverlay })
  }

  return concepts.length > 0 ? concepts : null
}

function parseIdeaScore(content: string): IdeaScore | null {
  const scoreSection = extractSection(content, 'Score')
  if (!scoreSection) return null

  const scoreMatch = scoreSection.match(/([\d.]+)\s*\/\s*10/)
  const score = scoreMatch?.[1] || '0'

  let status: 'greenlight' | 'hold' | 'pass' = 'pass'
  if (scoreSection.toLowerCase().includes('greenlight')) status = 'greenlight'
  else if (scoreSection.toLowerCase().includes('hold')) status = 'hold'

  // Parse criteria
  const criteriaSection = extractSection(content, 'Criteria')
  const criteria: Array<{ name: string; score: string; reason: string }> = []
  const criteriaRegex = /-\s*\*\*(.+?):\*\*\s*([\d/]+)\s*(?:—|-)\s*(.+)/g
  let cMatch
  while ((cMatch = criteriaRegex.exec(criteriaSection)) !== null) {
    criteria.push({
      name: cMatch[1].trim(),
      score: cMatch[2].trim(),
      reason: cMatch[3].trim(),
    })
  }

  // Parse improvements
  const improvementsSection = extractSection(content, 'Improvements')
  const improvements = improvementsSection
    .split('\n')
    .filter(line => line.trim().startsWith('-'))
    .map(line => line.replace(/^-\s*/, '').trim())

  return { score, status, criteria, improvements }
}

function parseTrendItems(content: string): TrendItem[] | null {
  const trends: TrendItem[] = []

  // Match ### [Title] sections
  const trendRegex = /###\s+(.+?)\s*\n([\s\S]*?)(?=###|$)/g
  let match
  while ((match = trendRegex.exec(content)) !== null) {
    const title = match[1].trim()
    const section = match[2]

    const summary = section.match(/\*\*Summary:\*\*\s*(.+)/i)?.[1]?.trim() || ''
    const opportunityScore = section.match(/\*\*Opportunity Score:\*\*\s*(.+)/i)?.[1]?.trim() || ''
    const recommendation = section.match(/\*\*Recommendation:\*\*\s*(.+)/i)?.[1]?.trim() || ''
    const contentAngle = section.match(/\*\*Content Angle:\*\*\s*(.+)/i)?.[1]?.trim() || ''
    const whyNow = section.match(/\*\*Why Now:\*\*\s*(.+)/i)?.[1]?.trim() || ''

    if (title && summary) {
      trends.push({ title, summary, opportunityScore, recommendation, contentAngle, whyNow })
    }
  }

  return trends.length > 0 ? trends : null
}

interface ExtractedSection {
  type: 'thumbnail' | 'scene' | 'seo' | 'script'
  start: number
  end: number
  data: any
}

export function parseCompositeBlocks(textContent: string, category: string): ContentBlock[] {
  const sections: ExtractedSection[] = []

  // 1. Script section (Primary: deterministic delimiters <!-- SCRIPT_START --> ... <!-- SCRIPT_END -->)
  const SCRIPT_DELIMITER_REGEX = /(?:<!--\s*SCRIPT_START\s*-->|<<<SCRIPT_START>>>)([\s\S]*?)(?:<!--\s*SCRIPT_END\s*-->|<<<SCRIPT_END>>>|$)/i
  const delimMatch = SCRIPT_DELIMITER_REGEX.exec(textContent)

  if (delimMatch && delimMatch.index !== undefined) {
    const scriptStart = delimMatch.index
    const scriptEnd = scriptStart + delimMatch[0].length
    const cleanScript = stripScriptDelimiters(delimMatch[1] || '')
    if (cleanScript.length > 50) {
      sections.push({
        type: 'script',
        start: scriptStart,
        end: scriptEnd,
        data: cleanScript,
      })
    }
  } else {
    // Fallback: Legacy regex for past conversations in DB without delimiters
    const SECTION_8_REGEX = /(?:^#{1,3}\s*(?:8\.\s*)?(?:[^\n]*\b(?:LIVE|TELEPROMPTER|FULL|EPISODE|RECORDING)\s+)?SCRIPT\b|^#{1,3}\s*(?:8\.\s*)?SCRIPT\s*(?:\r?\n|:|$)|^#\s+[^\n]+\n+##\s+(?:(?:\d+[:.]\d+.*?|\d+\.\s*)?COLD\s+OPEN)|^##\s+(?:(?:\d+[:.]\d+.*?|\d+\.\s*)?COLD\s+OPEN))/im
    const sec8Match = SECTION_8_REGEX.exec(textContent)
    if (sec8Match && sec8Match.index !== undefined) {
      const scriptStart = sec8Match.index
      const remainder = textContent.slice(scriptStart)
      const POSTAMBLE_REGEX = /(?:^#{1,3}\s*(?:9\.\s*)?YOUTUBE\s+DESCRIPTION|^#{1,3}\s*(?:17\.\s*)?.*VERIFIED\s+YOUTUBE|^##\s+17\.\s+|^##\s+18\.\s+|^##\s+Sources|^##\s+SEO|^##\s+Thumbnail|^##\s+Title|^#\s+📌\s*PINNED\s*COMMENT|^#\s+SEO\s*(?:DESCRIPTION|TAGS|PACKAGE))/im
      const postMatch = POSTAMBLE_REGEX.exec(remainder)
      const scriptEnd = postMatch && postMatch.index !== undefined ? scriptStart + postMatch.index : textContent.length
      const scriptContent = textContent.slice(scriptStart, scriptEnd).trim()
      if (scriptContent.length > 50) {
        sections.push({
          type: 'script',
          start: scriptStart,
          end: scriptEnd,
          data: stripScriptDelimiters(scriptContent),
        })
      }
    }
  }

  // 2. Thumbnail concepts section (Primary: deterministic delimiters <!-- THUMBNAILS_START --> ... <!-- THUMBNAILS_END -->)
  const THUMBNAILS_DELIMITER_REGEX = /(?:<!--\s*THUMBNAILS_START\s*-->|<<<THUMBNAILS_START>>>)([\s\S]*?)(?:<!--\s*THUMBNAILS_END\s*-->|<<<THUMBNAILS_END>>>|$)/i
  const thumbDelimMatch = THUMBNAILS_DELIMITER_REGEX.exec(textContent)

  if (thumbDelimMatch && thumbDelimMatch.index !== undefined) {
    const thumbStart = thumbDelimMatch.index
    const thumbEnd = thumbStart + thumbDelimMatch[0].length
    const cleanThumbnailsText = stripThumbnailDelimiters(thumbDelimMatch[1] || '')
    const concepts = parseThumbnailContent(cleanThumbnailsText)
    if (concepts && concepts.length > 0) {
      sections.push({
        type: 'thumbnail',
        start: thumbStart,
        end: thumbEnd,
        data: concepts,
      })
    }
  } else {
    // Fallback: Legacy / non-delimited formats
    const THUMBNAIL_HEADER_REGEX = /(?:^|\n)(?:#{1,3}\s*)?(?:(?:\d+\.\s*)?[^\n]*\bTHUMBNAIL\s*(?:DIRECTION|CONCEPTS?|IDEAS?|OPTIONS?|DESIGNS?|PACKAGE|SUGGESTIONS?|PREVIEW)\b[^\n]*|(?:\*{0,2}Concept\s*#?1\b[^\n]*))/i
    const thumbHeaderMatch = THUMBNAIL_HEADER_REGEX.exec(textContent)

    if (thumbHeaderMatch && thumbHeaderMatch.index !== undefined) {
      const matchedStr = thumbHeaderMatch[0]
      const headerStart = thumbHeaderMatch.index + (matchedStr.startsWith('\n') ? 1 : 0)
      const afterHeader = textContent.slice(headerStart)

      // Find the end: next section heading, recommendation note, or separator
      const NEXT_SECTION_REGEX = /(?:\n\n(?:\*{0,2}(?:Best choice|Best pick|My Recommendation|Recommendation|Why this|Note|Optional Title|Sources)\b|---)|\n#{1,3}\s+(?!Concept\b|Thumbnail\b)[^\n]+)/i
      const firstLineEnd = afterHeader.indexOf('\n')
      const searchAfterHeader = firstLineEnd !== -1 ? afterHeader.slice(firstLineEnd) : ''
      const nextSectionMatch = NEXT_SECTION_REGEX.exec(searchAfterHeader)

      const sectionLength = nextSectionMatch && nextSectionMatch.index !== undefined
        ? firstLineEnd + nextSectionMatch.index
        : afterHeader.length

      const thumbSectionText = afterHeader.slice(0, sectionLength).trim()
      const concepts = parseThumbnailContent(thumbSectionText)
      if (concepts && concepts.length > 0) {
        sections.push({
          type: 'thumbnail',
          start: headerStart,
          end: headerStart + sectionLength,
          data: concepts,
        })
      }
    } else if (category === 'thumbnail') {
      const concept1Match = /(?:^|\n)(?:#{1,3}\s*)?(?:\*{0,2}Concept\s*#?1\b|1\.\s*["“]?)/i.exec(textContent)
      const concepts = parseThumbnailContent(textContent)
      if (concepts && concepts.length > 0) {
        const start = concept1Match && concept1Match.index !== undefined
          ? concept1Match.index + (concept1Match[0].startsWith('\n') ? 1 : 0)
          : 0
        sections.push({
          type: 'thumbnail',
          start,
          end: textContent.length,
          data: concepts,
        })
      }
    }
  }

  // 3. Scene concepts section
  const SCENE_HEADER_REGEX = /(?:^|\n)(#{1,3}\s*(?:\d+\.\s*)?(?:SCENE\s*CONCEPTS?|VISUAL\s*BREAKDOWN|B-ROLL\s*PROMPTS?)\b[^\n]*|(?=#{1,3}\s*Scene\s*(?:Concept\s*)?1\b))/i
  const sceneHeaderMatch = SCENE_HEADER_REGEX.exec(textContent)
  if (sceneHeaderMatch && sceneHeaderMatch.index !== undefined) {
    const matchedStr = sceneHeaderMatch[0]
    const headerStart = sceneHeaderMatch.index + (matchedStr.startsWith('\n') ? 1 : 0)
    const afterHeader = textContent.slice(headerStart)
    const firstLineEnd = afterHeader.indexOf('\n')
    const searchAfterHeader = firstLineEnd !== -1 ? afterHeader.slice(firstLineEnd) : ''
    const NEXT_SECTION_REGEX = /(?:\n---\s*)?\n(#{1,3}\s+(?!Scene\b|Visual\b)[^\n]+)/i
    const nextSectionMatch = NEXT_SECTION_REGEX.exec(searchAfterHeader)
    const sectionLength = nextSectionMatch && nextSectionMatch.index !== undefined
      ? firstLineEnd + nextSectionMatch.index
      : afterHeader.length
    const sceneSectionText = afterHeader.slice(0, sectionLength).trim()
    const scenes = parseSceneConcepts(sceneSectionText)
    if (scenes && scenes.length > 0) {
      sections.push({
        type: 'scene',
        start: headerStart,
        end: headerStart + sectionLength,
        data: scenes,
      })
    }
  } else if (category === 'image') {
    const scenes = parseSceneConcepts(textContent)
    if (scenes && scenes.length > 0) {
      sections.push({
        type: 'scene',
        start: 0,
        end: textContent.length,
        data: scenes,
      })
    }
  }

  // 4. SEO Section (e.g. ## SEO Package or ## Title + ## Description + ## Tags)
  const SEO_HEADER_REGEX = /(?:^|\n)(#{1,3}\s*(?:\d+\.\s*)?(?:SEO\s*(?:PACKAGE|METADATA|OPTIMIZATION|SUGGESTIONS?)|METADATA\s*PACKAGE)\b[^\n]*|(?=#{1,3}\s*Title\b[\s\S]*?#{1,3}\s*Description\b))/i
  const seoHeaderMatch = SEO_HEADER_REGEX.exec(textContent)
  if (seoHeaderMatch && seoHeaderMatch.index !== undefined) {
    const matchedStr = seoHeaderMatch[0]
    const headerStart = seoHeaderMatch.index + (matchedStr.startsWith('\n') ? 1 : 0)
    const afterHeader = textContent.slice(headerStart)
    const firstLineEnd = afterHeader.indexOf('\n')
    const searchAfterHeader = firstLineEnd !== -1 ? afterHeader.slice(firstLineEnd) : ''
    const NEXT_SECTION_REGEX = /(?:\n---\s*)?\n(#{1,3}\s+(?!Title\b|Description\b|Tags\b|Hashtags\b|Keywords\b)[^\n]+)/i
    const nextSectionMatch = NEXT_SECTION_REGEX.exec(searchAfterHeader)
    const sectionLength = nextSectionMatch && nextSectionMatch.index !== undefined
      ? firstLineEnd + nextSectionMatch.index
      : afterHeader.length
    const seoSectionText = afterHeader.slice(0, sectionLength).trim()
    const seo = parseSeoContent(seoSectionText)
    if (seo) {
      sections.push({
        type: 'seo',
        start: headerStart,
        end: headerStart + sectionLength,
        data: seo,
      })
    }
  } else if (category === 'seo') {
    const seo = parseSeoContent(textContent)
    if (seo) {
      sections.push({
        type: 'seo',
        start: 0,
        end: textContent.length,
        data: seo,
      })
    }
  }

  // Sort sections by start position and filter out overlapping ranges
  sections.sort((a, b) => a.start - b.start)
  const nonOverlapping: ExtractedSection[] = []
  let lastEnd = 0
  for (const sec of sections) {
    if (sec.start >= lastEnd) {
      nonOverlapping.push(sec)
      lastEnd = sec.end
    }
  }

  // If no specialized sections were extracted:
  if (nonOverlapping.length === 0) {
    if (category === 'ideas' || textContent.includes('## Criteria Breakdown') || textContent.includes('## Overall Score')) {
      const ideaScore = parseIdeaScore(textContent)
      if (ideaScore) return [{ type: 'ideas', ideaScore, raw: textContent }]
    }
    if (category === 'trends' || (textContent.includes('Opportunity Score:') && textContent.includes('### '))) {
      const trends = parseTrendItems(textContent)
      if (trends) return [{ type: 'trends', trends, raw: textContent }]
    }
    if ((category === 'outline' || category === 'general') && textContent.includes('## Hook Options')) {
      return [{ type: 'outline', content: textContent, raw: textContent }]
    }
    if (category === 'script') {
      return [{ type: 'script', scriptContent: textContent, raw: textContent }]
    }
    return [{ type: 'markdown', content: stripThumbnailDelimiters(stripScriptDelimiters(textContent)) }]
  }

  // Assemble blocks in chronological order
  const blocks: ContentBlock[] = []
  let cursor = 0

  for (const sec of nonOverlapping) {
    if (sec.start > cursor) {
      const textChunk = stripThumbnailDelimiters(stripScriptDelimiters(textContent.slice(cursor, sec.start).trim()))
      if (textChunk.length > 0) {
        blocks.push({ type: 'markdown', content: textChunk })
      }
    }

    if (sec.type === 'thumbnail') {
      blocks.push({ type: 'thumbnail', thumbnails: sec.data, raw: textContent.slice(sec.start, sec.end) })
    } else if (sec.type === 'scene') {
      blocks.push({ type: 'scene', sceneConcepts: sec.data, raw: textContent.slice(sec.start, sec.end) })
    } else if (sec.type === 'seo') {
      blocks.push({ type: 'seo', seo: sec.data, raw: textContent.slice(sec.start, sec.end) })
    } else if (sec.type === 'script') {
      blocks.push({ type: 'script', scriptContent: stripScriptDelimiters(sec.data), raw: textContent.slice(sec.start, sec.end) })
    }

    cursor = sec.end
  }

  if (cursor < textContent.length) {
    const trailingText = stripThumbnailDelimiters(stripScriptDelimiters(textContent.slice(cursor).trim()))
    if (trailingText.length > 0) {
      blocks.push({ type: 'markdown', content: trailingText })
    }
  }

  return blocks
}

export function detectAndParse(content: any, category: string): ParsedContent {
  const textContent = typeof content === 'string' ? content : (content ? String(content) : '')
  const sources = extractSources(textContent)

  const blocks = parseCompositeBlocks(textContent, category)

  // If multiple blocks exist, return composite document
  if (blocks.length > 1) {
    // Check if it's the classic modular_package (markdown preamble + script + markdown postamble)
    const scriptBlock = blocks.find(b => b.type === 'script')
    const hasThumb = blocks.some(b => b.type === 'thumbnail')
    const hasSeo = blocks.some(b => b.type === 'seo')
    const hasScene = blocks.some(b => b.type === 'scene')

    // If it's strictly a 3-part script package without interactive cards, preserve legacy modular_package
    if (scriptBlock && !hasThumb && !hasSeo && !hasScene && blocks.length <= 3) {
      const preambleBlock = blocks.find((b, idx) => idx === 0 && b.type === 'markdown')
      const postambleBlock = blocks.find((b, idx) => idx > 0 && b.type === 'markdown')
      return {
        type: 'modular_package',
        raw: textContent,
        preamble: preambleBlock?.type === 'markdown' ? preambleBlock.content : '',
        teleprompterScript: scriptBlock.type === 'script' ? scriptBlock.scriptContent : '',
        postamble: postambleBlock?.type === 'markdown' ? postambleBlock.content : '',
        sources,
        blocks,
      }
    }

    return {
      type: 'composite',
      raw: textContent,
      blocks,
      sources,
    }
  }

  // Single block handling
  const single = blocks[0] || { type: 'markdown', content: textContent }

  if (single.type === 'thumbnail') {
    return { type: 'thumbnail', raw: textContent, thumbnails: single.thumbnails, sources, blocks }
  }
  if (single.type === 'scene') {
    return { type: 'image', raw: textContent, sceneConcepts: single.sceneConcepts, sources, blocks }
  }
  if (single.type === 'seo') {
    return { type: 'seo', raw: textContent, seo: single.seo, sources, blocks }
  }
  if (single.type === 'script') {
    return { type: 'script', raw: textContent, sources, blocks }
  }
  if (single.type === 'ideas') {
    return { type: 'ideas', raw: textContent, ideaScore: single.ideaScore, sources, blocks }
  }
  if (single.type === 'trends') {
    return { type: 'trends', raw: textContent, trends: single.trends, sources, blocks }
  }
  if (single.type === 'outline') {
    return { type: 'outline', raw: textContent, sources, blocks }
  }

  return { type: 'markdown', raw: textContent, sources, blocks }
}

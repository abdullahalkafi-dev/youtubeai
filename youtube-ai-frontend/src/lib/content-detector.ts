export type ContentType = 'seo' | 'thumbnail' | 'ideas' | 'trends' | 'script' | 'outline' | 'image' | 'markdown'

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

export interface ParsedContent {
  type: ContentType
  raw: string
  seo?: SeoContent
  thumbnails?: ThumbnailConcept[]
  sceneConcepts?: SceneConcept[]
  ideaScore?: IdeaScore
  trends?: TrendItem[]
  sources?: Array<{ title: string; url: string }>
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
  const concepts: ThumbnailConcept[] = []

  // Pattern A: Standard ### Concept \d+ or ### 1. or numbered concepts like 1. "TITLE"
  const conceptRegex = /(?:###|##|\b)\s*(?:Concept\s*\d+|\d+\.\s*["“]?([^"\n\r”]+)["”]?)\s*\n([\s\S]*?)(?=(?:###|##|\b)\s*(?:Concept\s*\d+|\d+\.\s*["“]?)|---|\n\nBest Pick:|$)/gi
  let match
  while ((match = conceptRegex.exec(content)) !== null) {
    const section = match[2] || match[0]

    // Extract text overlay
    const textMatch = section.match(/(?:\*\*Text overlay:\*\*|Thumbnail Text:|Text overlay:|Text:)\s*(.+)/i)
    const text = textMatch?.[1]?.replace(/\*\*/g, '').trim() || ''

    // Extract visual concept
    const visualMatch = section.match(/(?:\*\*Visual concept:\*\*|Visual Hook:|Visual:|Visual concept:)\s*([\s\S]*?)(?=\n\s*(?:Composition:|Color Strategy:|Color scheme:|Why It Clicks:|AI \/ Designer Prompt:|\*\*Color scheme:\*\*|$))/i)
      || section.match(/(?:AI \/ Designer Prompt:|AI Prompt:)\s*(.+)/i)
    const visual = visualMatch?.[1]?.replace(/\*\*/g, '').trim() || ''

    // Extract color scheme
    const colorMatch = section.match(/(?:\*\*Color scheme:\*\*|Color Strategy:|Colors:|Color scheme:)\s*([\s\S]*?)(?=\n\s*(?:Why It Clicks:|AI \/ Designer Prompt:|$))/i)
    const colors = colorMatch?.[1]?.replace(/\*\*/g, '').trim() || ''

    if (text || visual) {
      concepts.push({ text, visual, colors })
    }
  }

  // Fallback: If not partitioned into sections but contains explicit thumbnail keys
  if (concepts.length === 0) {
    const textMatches = Array.from(content.matchAll(/(?:Thumbnail Text:|Text overlay:)\s*(.+)/gi))
    const visualMatches = Array.from(content.matchAll(/(?:Visual Hook:|Visual concept:|AI \/ Designer Prompt:)\s*(.+)/gi))
    for (let i = 0; i < Math.max(textMatches.length, visualMatches.length); i++) {
      const text = textMatches[i]?.[1]?.replace(/\*\*/g, '').trim() || ''
      const visual = visualMatches[i]?.[1]?.replace(/\*\*/g, '').trim() || ''
      if (text || visual) {
        concepts.push({ text, visual, colors: '' })
      }
    }
  }

  return concepts.length > 0 ? concepts : null
}

function parseSceneConcepts(content: string): SceneConcept[] | null {
  const concepts: SceneConcept[] = []
  const conceptRegex = /### Scene Concept \d+\s*\n([\s\S]*?)(?=### Scene Concept|###|$)/gi
  let match
  while ((match = conceptRegex.exec(content)) !== null) {
    const section = match[1]
    const scene = section.match(/\*\*Scene:\*\*\s*(.+)/i)?.[1]?.trim() || ''
    const style = section.match(/\*\*Style:\*\*\s*(.+)/i)?.[1]?.trim() || ''
    const colors = section.match(/\*\*Colors:\*\*\s*(.+)/i)?.[1]?.trim() || ''
    const textOverlay = section.match(/\*\*Text overlay.*:\*\*\s*(.+)/i)?.[1]?.trim() || ''
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

export function detectAndParse(content: any, category: string): ParsedContent {
  const textContent = typeof content === 'string' ? content : (content ? String(content) : '')
  const sources = extractSources(textContent)

  // Try parsing based on category first
  if (category === 'seo') {
    const seo = parseSeoContent(textContent)
    if (seo) return { type: 'seo', raw: textContent, seo, sources }
  }

  if (category === 'thumbnail') {
    const thumbnails = parseThumbnailContent(textContent)
    if (thumbnails) return { type: 'thumbnail', raw: textContent, thumbnails, sources }
  }

  if (category === 'image') {
    const scenes = parseSceneConcepts(textContent)
    if (scenes) return { type: 'image', raw: textContent, sceneConcepts: scenes, sources }
  }

  if (category === 'ideas') {
    const ideaScore = parseIdeaScore(textContent)
    if (ideaScore) return { type: 'ideas', raw: textContent, ideaScore, sources }
  }

  if (category === 'trends') {
    const trends = parseTrendItems(textContent)
    if (trends) return { type: 'trends', raw: textContent, trends, sources }
  }

  if (category === 'outline' && textContent.includes('## Hook Options')) {
    return { type: 'outline', raw: textContent, sources }
  }

  if (category === 'script') {
    return { type: 'script', raw: textContent, sources }
  }

  // Content-based detection (fallback)
  const detectedThumbnails = parseThumbnailContent(textContent)
  if (detectedThumbnails && (category === 'thumbnail' || textContent.includes('Thumbnail Text:') || textContent.includes('**Text overlay:**') || textContent.includes('Visual Hook:'))) {
    return { type: 'thumbnail', raw: textContent, thumbnails: detectedThumbnails, sources }
  }

  if (textContent.includes('## Title') && textContent.includes('## Description') && textContent.includes('## Tags')) {
    const seo = parseSeoContent(textContent)
    if (seo) return { type: 'seo', raw: textContent, seo, sources }
  }

  if (textContent.includes('### Scene Concept') && textContent.includes('**Scene:**')) {
    const scenes = parseSceneConcepts(textContent)
    if (scenes) return { type: 'image', raw: textContent, sceneConcepts: scenes, sources }
  }

  if (textContent.includes('## Score') && textContent.includes('## Criteria')) {
    const ideaScore = parseIdeaScore(textContent)
    if (ideaScore) return { type: 'ideas', raw: textContent, ideaScore, sources }
  }

  if (textContent.includes('## Hook Options') && textContent.includes('## Outline')) {
    return { type: 'outline', raw: textContent, sources }
  }

  const isThumbnailText = Boolean(detectedThumbnails || textContent.includes('Thumbnail Text:') || textContent.includes('Visual Hook:'))

  const hasScriptMarkers =
    !isThumbnailText &&
    (textContent.includes('💎 JEWEL') ||
    /cold\s+open/i.test(textContent) ||
    textContent.includes('[BEAT]') ||
    textContent.includes('[PAUSE]') ||
    textContent.includes('10 VIRAL QUESTIONS') ||
    (textContent.includes('## ') && textContent.includes('> ') && (textContent.includes('**•') || textContent.includes('**➤')) && !textContent.includes('Thumbnail Text:')))

  if (hasScriptMarkers) {
    return { type: 'script', raw: textContent, sources }
  }

  return { type: 'markdown', raw: textContent, sources }
}

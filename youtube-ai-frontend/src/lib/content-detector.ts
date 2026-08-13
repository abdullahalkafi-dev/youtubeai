export type ContentType = 'seo' | 'thumbnail' | 'ideas' | 'trends' | 'script' | 'outline' | 'markdown'

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

  // Match ### Concept 1/2/3 sections
  const conceptRegex = /### Concept \d+\s*\n([\s\S]*?)(?=### Concept|$)/gi
  let match
  while ((match = conceptRegex.exec(content)) !== null) {
    const section = match[1]
    const text = section.match(/\*\*Text overlay:\*\*\s*(.+)/i)?.[1]?.trim() || ''
    const visual = section.match(/\*\*Visual concept:\*\*\s*(.+)/i)?.[1]?.trim() || ''
    const colors = section.match(/\*\*Color scheme:\*\*\s*(.+)/i)?.[1]?.trim() || ''
    if (text || visual) {
      concepts.push({ text, visual, colors })
    }
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

export function detectAndParse(content: string, category: string): ParsedContent {
  const sources = extractSources(content)

  // Try parsing based on category first
  if (category === 'seo') {
    const seo = parseSeoContent(content)
    if (seo) return { type: 'seo', raw: content, seo, sources }
  }

  if (category === 'thumbnail') {
    const thumbnails = parseThumbnailContent(content)
    if (thumbnails) return { type: 'thumbnail', raw: content, thumbnails, sources }
  }

  if (category === 'ideas') {
    const ideaScore = parseIdeaScore(content)
    if (ideaScore) return { type: 'ideas', raw: content, ideaScore, sources }
  }

  if (category === 'trends') {
    const trends = parseTrendItems(content)
    if (trends) return { type: 'trends', raw: content, trends, sources }
  }

  if (category === 'outline' && content.includes('## Hook Options')) {
    return { type: 'outline', raw: content, sources }
  }

  if (category === 'script') {
    return { type: 'script', raw: content, sources }
  }

  // Content-based detection (fallback)
  if (content.includes('## Title') && content.includes('## Description') && content.includes('## Tags')) {
    const seo = parseSeoContent(content)
    if (seo) return { type: 'seo', raw: content, seo, sources }
  }

  if (content.includes('### Concept') && content.includes('**Text overlay:**')) {
    const thumbnails = parseThumbnailContent(content)
    if (thumbnails) return { type: 'thumbnail', raw: content, thumbnails, sources }
  }

  if (content.includes('## Score') && content.includes('## Criteria')) {
    const ideaScore = parseIdeaScore(content)
    if (ideaScore) return { type: 'ideas', raw: content, ideaScore, sources }
  }

  if (content.includes('## Hook Options') && content.includes('## Outline')) {
    return { type: 'outline', raw: content, sources }
  }

  if (content.includes('💎 JEWEL') || content.includes('COLD OPEN') || content.includes('## COLD OPEN')) {
    return { type: 'script', raw: content, sources }
  }

  return { type: 'markdown', raw: content, sources }
}

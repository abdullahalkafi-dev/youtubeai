import { Logger } from '@nestjs/common';

export interface RssNewsTopic {
  title: string;
  summary: string;
  source: string;
  sourceUrl?: string;
  publishedAt?: string;
  sourceType: 'rss_news';
}

const logger = new Logger('RssFetcher');

/**
 * Fetch breaking niche news topics from Google News RSS feeds (0 YouTube Quota Units).
 */
export async function fetchGoogleNewsRss(nicheKeywords: string[]): Promise<RssNewsTopic[]> {
  const topics: RssNewsTopic[] = [];
  const searchQueries = [
    ...nicheKeywords.slice(0, 3),
    'rapper trial sentencing',
    'federal indictment court news',
  ];

  for (const keyword of searchQueries) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=en-US&gl=US&ceid=US:en`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        logger.warn(`RSS fetch failed for "${keyword}": HTTP ${response.status}`);
        continue;
      }

      const xml = await response.text();
      const items = parseRssXmlItems(xml);

      for (const item of items.slice(0, 3)) { // Top 3 news items per keyword
        if (!item.title) continue;

        // Strip source suffix from Google News title e.g. "Diddy Trial Update - NBC News" or "Diddy Trial Update — NBC News"
        const cleanTitle = item.title.replace(/\s*[\-\–\—]\s*[^\-\–\—]+$/, '').trim();
        const sourceName = item.source || item.title.split(/[\-\–\—]/).pop()?.trim() || 'Google News';

        topics.push({
          title: cleanTitle,
          summary: `Breaking news report via ${sourceName}`,
          source: sourceName,
          sourceUrl: item.link || undefined,
          publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
          sourceType: 'rss_news',
        });
      }
    } catch (error) {
      logger.warn(`Failed to fetch RSS news for keyword "${keyword}": ${error.message}`);
    }
  }

  logger.log(`Google News RSS fetched ${topics.length} breaking topics across ${searchQueries.length} niche keywords (0 quota cost).`);
  return topics;
}

interface ParsedXmlItem {
  title?: string;
  pubDate?: string;
  source?: string;
  link?: string;
}

function parseRssXmlItems(xml: string): ParsedXmlItem[] {
  const items: ParsedXmlItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1];
    const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(itemContent);
    const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(itemContent);
    const sourceMatch = /<source[^>]*>([\s\S]*?)<\/source>/i.exec(itemContent);
    const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(itemContent);

    const title = titleMatch ? cleanCdata(titleMatch[1]) : undefined;
    const pubDate = pubDateMatch ? cleanCdata(pubDateMatch[1]) : undefined;
    const source = sourceMatch ? cleanCdata(sourceMatch[1]) : undefined;
    const link = linkMatch ? cleanCdata(linkMatch[1]) : undefined;

    if (title) {
      items.push({ title, pubDate, source, link });
    }
  }

  return items;
}

function cleanCdata(str: string): string {
  return str
    .replace(/^<!\[CDATA\[/i, '')
    .replace(/\]\]>$/i, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

import { Injectable, Logger } from '@nestjs/common';

/**
 * YouTube Search Suggestions Service
 *
 * Uses Google's autocomplete API — free, no API key, no quota cost.
 * Returns what people actually type into YouTube search.
 *
 * Endpoint: https://suggestqueries.google.com/complete/search
 * Params: client=youtube, ds=yt, q=QUERY, hl=en
 */
@Injectable()
export class YouTubeSuggestionsService {
  private readonly logger = new Logger(YouTubeSuggestionsService.name);
  private readonly baseUrl = 'https://suggestqueries.google.com/complete/search';

  /**
   * Get autocomplete suggestions for a single query.
   * Returns array of suggestion strings.
   */
  async getSuggestions(query: string): Promise<string[]> {
    try {
      const url = `${this.baseUrl}?client=youtube&ds=yt&q=${encodeURIComponent(query)}&hl=en`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        this.logger.warn(`Suggestions API returned ${response.status} for "${query}"`);
        return [];
      }

      const text = await response.text();
      // Response format: window.google.ac.h(["QUERY",[["suggestion1",0],["suggestion2",0],...]])
      const jsonMatch = text.match(/\[.*\]/s);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed) || parsed.length < 2) return [];

      const suggestions = parsed[1];
      if (!Array.isArray(suggestions)) return [];

      return suggestions
        .map((item: any) => (Array.isArray(item) ? item[0] : String(item)))
        .filter((s: string) => s && s.length > 0);
    } catch (error) {
      this.logger.warn(`getSuggestions failed for "${query}": ${error.message}`);
      return [];
    }
  }

  /**
   * Get suggestions for multiple queries in parallel.
   * Returns map of query → suggestions array.
   */
  async getBulkSuggestions(queries: string[]): Promise<Map<string, string[]>> {
    const results = new Map<string, string[]>();

    // Cap at 10 parallel requests to avoid rate limiting
    const batch = queries.slice(0, 10);
    const promises = batch.map(async (query) => {
      const suggestions = await this.getSuggestions(query);
      return { query, suggestions };
    });

    const settled = await Promise.allSettled(promises);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.set(result.value.query, result.value.suggestions);
      }
    }

    return results;
  }

  /**
   * Calculate search demand score from autocomplete frequency.
   * Takes a list of keywords, checks how often each appears in suggestions
   * for related queries, and normalizes to 0-100 using log scale.
   *
   * Higher score = more people searching for it.
   */
  async getSearchDemand(keywords: string[]): Promise<Map<string, number>> {
    const demandMap = new Map<string, number>();
    if (keywords.length === 0) return demandMap;

    // Get suggestions for each keyword
    const suggestionsMap = await this.getBulkSuggestions(keywords);

    // Count how many times each keyword appears across all suggestion sets
    const counts = new Map<string, number>();
    for (const keyword of keywords) {
      const suggestions = suggestionsMap.get(keyword) || [];
      const lowerKeyword = keyword.toLowerCase();
      let count = 0;

      // Count appearances in own suggestions
      for (const suggestion of suggestions) {
        if (suggestion.toLowerCase().includes(lowerKeyword)) {
          count++;
        }
      }

      // Also count appearances in other keywords' suggestions
      for (const [otherKeyword, otherSuggestions] of suggestionsMap) {
        if (otherKeyword === keyword) continue;
        for (const suggestion of otherSuggestions) {
          if (suggestion.toLowerCase().includes(lowerKeyword)) {
            count++;
          }
        }
      }

      counts.set(keyword, count);
    }

    // Normalize to 0-100 using log scale for better distribution
    // This prevents the bimodal 0/100 problem with linear normalization
    const maxCount = Math.max(...Array.from(counts.values()), 1);
    for (const [keyword, count] of counts) {
      if (count === 0) {
        demandMap.set(keyword, 0);
      } else {
        // Log scale: log(count + 1) / log(maxCount + 1) * 100
        // This gives a more natural distribution where keywords with some demand
        // get mid-range scores instead of being forced to 0 or 100
        const score = Math.round(
          (Math.log(count + 1) / Math.log(maxCount + 1)) * 100
        );
        demandMap.set(keyword, Math.min(100, Math.max(1, score)));
      }
    }

    return demandMap;
  }
}

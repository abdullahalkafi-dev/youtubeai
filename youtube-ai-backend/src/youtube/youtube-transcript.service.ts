import { Injectable, Logger } from '@nestjs/common';

// Safely require youtube-transcript to avoid Node16 ESM/CJS type resolution mismatch in Docker
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { YoutubeTranscript } = require('youtube-transcript');

export interface TranscriptSegment {
  text: string;
  startSeconds: number;
  timestamp: string; // "MM:SS" or "HH:MM:SS"
}

export type TranscriptSource = 'innertube_android' | 'innertube_ios' | 'innertube_web' | 'official_oauth' | 'none';

@Injectable()
export class YouTubeTranscriptService {
  private readonly logger = new Logger(YouTubeTranscriptService.name);

  /**
   * Fetch public video transcript with timestamps (0 YouTube API quota cost)
   * Uses Multi-Tier InnerTube Client Pipeline: Android -> iOS -> Web Scraper
   */
  async getTranscript(youtubeVideoId: string): Promise<{
    fullText: string;
    segments: TranscriptSegment[];
    source: TranscriptSource;
  } | null> {
    this.logger.log(`Fetching 0-quota transcript for video: ${youtubeVideoId}`);

    // Tier 1: InnerTube Android Mobile Client (Bypasses web consent/bot challenges)
    try {
      const androidRes = await this.fetchInnerTubeAndroid(youtubeVideoId);
      if (androidRes && androidRes.segments.length > 0 && androidRes.fullText.trim().length > 0) {
        this.logger.log(`[Tier 1 Success] InnerTube Android extracted ${androidRes.segments.length} segments for ${youtubeVideoId} (0 quota)`);
        return { ...androidRes, source: 'innertube_android' };
      }
    } catch (e: any) {
      this.logger.debug(`[Tier 1 Note] Android client fell through for ${youtubeVideoId}: ${e.message}`);
    }

    // Tier 2: InnerTube iOS Mobile Client (Secondary 0-quota mobile fallback)
    try {
      const iosRes = await this.fetchInnerTubeIOS(youtubeVideoId);
      if (iosRes && iosRes.segments.length > 0 && iosRes.fullText.trim().length > 0) {
        this.logger.log(`[Tier 2 Success] InnerTube iOS extracted ${iosRes.segments.length} segments for ${youtubeVideoId} (0 quota)`);
        return { ...iosRes, source: 'innertube_ios' };
      }
    } catch (e: any) {
      this.logger.debug(`[Tier 2 Note] iOS client fell through for ${youtubeVideoId}: ${e.message}`);
    }

    // Tier 3: Classic Web Transcript Scraper
    try {
      const webRes = await this.fetchWebTranscript(youtubeVideoId);
      if (webRes && webRes.segments.length > 0 && webRes.fullText.trim().length > 0) {
        this.logger.log(`[Tier 3 Success] Web scraper extracted ${webRes.segments.length} segments for ${youtubeVideoId} (0 quota)`);
        return { ...webRes, source: 'innertube_web' };
      }
    } catch (e: any) {
      this.logger.debug(`[Tier 3 Note] Web scraper fell through for ${youtubeVideoId}: ${e.message}`);
    }

    this.logger.warn(`All 0-quota transcript tiers returned no usable segments for ${youtubeVideoId} (escalating to Tier 4 OAuth)`);
    return null;
  }

  /**
   * Tier 1: InnerTube Android Client Request
   */
  private async fetchInnerTubeAndroid(videoId: string): Promise<{ fullText: string; segments: TranscriptSegment[] } | null> {
    const payload = {
      context: {
        client: {
          clientName: 'ANDROID',
          clientVersion: '19.09.37',
          androidSdkVersion: 34,
          hl: 'en',
          gl: 'US',
        },
      },
      videoId,
    };

    const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11; US) gzip',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': '19.09.37',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    return this.extractFromPlayerResponse(data, videoId);
  }

  /**
   * Tier 2: InnerTube iOS Client Request
   */
  private async fetchInnerTubeIOS(videoId: string): Promise<{ fullText: string; segments: TranscriptSegment[] } | null> {
    const payload = {
      context: {
        client: {
          clientName: 'IOS',
          clientVersion: '19.09.3',
          deviceModel: 'iPhone14,3',
          hl: 'en',
          gl: 'US',
        },
      },
      videoId,
    };

    const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 16_0 like Mac OS X; US)',
        'X-YouTube-Client-Name': '5',
        'X-YouTube-Client-Version': '19.09.3',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    return this.extractFromPlayerResponse(data, videoId);
  }

  /**
   * Extract and parse captionTracks from InnerTube player response
   */
  private async extractFromPlayerResponse(playerData: any, videoId: string): Promise<{ fullText: string; segments: TranscriptSegment[] } | null> {
    const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
      return null;
    }

    // Language & ASR Hierarchy Matching:
    // 1. Manual English track
    // 2. Automatic Speech Recognition ('asr') English track
    // 3. Any manual track
    // 4. Any ASR track
    const manualEn = captionTracks.find(
      (t: any) => !t.kind && (t.languageCode === 'en' || t.languageCode?.startsWith('en') || t.vssId?.includes('.en')),
    );
    const asrEn = captionTracks.find(
      (t: any) => t.kind === 'asr' && (t.languageCode === 'en' || t.languageCode?.startsWith('en') || t.vssId?.includes('a.en')),
    );
    const anyManual = captionTracks.find((t: any) => !t.kind);
    const chosenTrack = manualEn || asrEn || anyManual || captionTracks[0];

    if (!chosenTrack?.baseUrl) {
      return null;
    }

    // 1. Try fmt=json3 format first
    try {
      const jsonUrl = chosenTrack.baseUrl.includes('fmt=') ? chosenTrack.baseUrl : `${chosenTrack.baseUrl}&fmt=json3`;
      const jsonRes = await fetch(jsonUrl, {
        headers: {
          'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11; US) gzip',
        },
        signal: AbortSignal.timeout(8000),
      });
      const jsonData: any = await jsonRes.json();

      if (jsonData && Array.isArray(jsonData.events) && jsonData.events.length > 0) {
        const segments: TranscriptSegment[] = [];
        let fullText = '';

        for (const event of jsonData.events) {
          if (!event.segs || !Array.isArray(event.segs)) continue;
          const rawText = event.segs.map((s: any) => s.utf8 || '').join('');
          const cleanText = this.decodeHtmlEntities(rawText);
          if (!cleanText) continue;

          const startSeconds = Math.floor((event.tStartMs || 0) / 1000);
          const mins = Math.floor(startSeconds / 60);
          const secs = startSeconds % 60;
          const timestamp = `${mins}:${secs.toString().padStart(2, '0')}`;

          segments.push({
            text: cleanText,
            startSeconds,
            timestamp,
          });
          fullText += `${cleanText} `;
        }

        // PO-Token / empty track check
        if (segments.length > 0 && fullText.trim().length > 0) {
          return { fullText: fullText.trim(), segments };
        }
      }
    } catch {
      // Fall through to XML parsing
    }

    // 2. Try raw XML format
    try {
      const xmlRes = await fetch(chosenTrack.baseUrl, {
        headers: {
          'User-Agent': 'com.google.android.youtube/19.09.37 (Linux; U; Android 11; US) gzip',
        },
        signal: AbortSignal.timeout(8000),
      });
      const xmlData = await xmlRes.text();

      if (xmlData && typeof xmlData === 'string') {
        const parsed = this.parseXmlTranscript(xmlData);
        if (parsed && parsed.segments.length > 0 && parsed.fullText.trim().length > 0) {
          return parsed;
        }
      }
    } catch {
      // XML parsing failed
    }

    return null;
  }

  /**
   * Tier 3: Classic Web Transcript Scraper
   */
  private async fetchWebTranscript(videoId: string): Promise<{ fullText: string; segments: TranscriptSegment[] } | null> {
    const raw = await YoutubeTranscript.fetchTranscript(videoId);
    if (!raw || !Array.isArray(raw) || raw.length === 0) return null;

    const segments: TranscriptSegment[] = [];
    let fullText = '';

    for (const item of raw) {
      const rawOffset = (item as any).offset ?? (item as any).start ?? 0;
      const totalSec = Math.floor(rawOffset > 10000 ? rawOffset / 1000 : rawOffset);

      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      const timestamp = `${mins}:${secs.toString().padStart(2, '0')}`;

      const cleanText = this.decodeHtmlEntities(item.text || '');

      if (cleanText) {
        segments.push({
          text: cleanText,
          startSeconds: totalSec,
          timestamp,
        });
        fullText += `${cleanText} `;
      }
    }

    if (segments.length === 0 || fullText.trim().length === 0) return null;
    return { fullText: fullText.trim(), segments };
  }

  /**
   * Sample timed transcript anchors for OpenAI prompt context.
   * Returns ~8-10 evenly spaced timestamp anchors so AI can build REAL video chapters.
   */
  formatTranscriptAnchors(segments: TranscriptSegment[]): string {
    if (!segments || segments.length === 0) return '';
    const step = Math.max(1, Math.floor(segments.length / 10));
    const sampled = segments.filter((_, idx) => idx % step === 0).slice(0, 10);
    return sampled.map(s => `[${s.timestamp}] "${s.text}"`).join('\n');
  }

  /**
   * Parse raw XML timed text (<text start="X" dur="Y">...)
   */
  private parseXmlTranscript(xmlContent: string): { fullText: string; segments: TranscriptSegment[] } | null {
    if (!xmlContent || typeof xmlContent !== 'string') return null;

    const regex = /<text\s+start="([\d\.]+)"(?:\s+dur="([\d\.]+)")?[^>]*>([\s\S]*?)<\/text>/gi;
    const segments: TranscriptSegment[] = [];
    let fullText = '';
    let match: RegExpExecArray | null;

    while ((match = regex.exec(xmlContent)) !== null) {
      const startSeconds = Math.floor(parseFloat(match[1]) || 0);
      const rawText = match[3] || '';
      const cleanText = this.decodeHtmlEntities(rawText);

      if (cleanText) {
        const mins = Math.floor(startSeconds / 60);
        const secs = startSeconds % 60;
        const timestamp = `${mins}:${secs.toString().padStart(2, '0')}`;

        segments.push({
          text: cleanText,
          startSeconds,
          timestamp,
        });
        fullText += `${cleanText} `;
      }
    }

    if (segments.length === 0 || fullText.trim().length === 0) return null;
    return { fullText: fullText.trim(), segments };
  }

  /**
   * Parse raw VTT or SRT caption file content downloaded from official YouTube Captions API
   */
  parseVttOrSrtToSegments(vttOrSrtContent: string): { fullText: string; segments: TranscriptSegment[] } | null {
    if (!vttOrSrtContent || typeof vttOrSrtContent !== 'string') return null;

    const lines = vttOrSrtContent.split(/\r?\n/);
    const segments: TranscriptSegment[] = [];
    let fullText = '';

    const timeRegex = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[\.,](\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})[\.,](\d{3})/;

    let currentTimestamp = '';
    let currentStartSec = 0;
    let currentText = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line || line === 'WEBVTT' || /^\d+$/.test(line) || line.startsWith('NOTE') || line.startsWith('STYLE')) {
        if (currentText && currentTimestamp) {
          segments.push({
            text: currentText,
            startSeconds: currentStartSec,
            timestamp: currentTimestamp,
          });
          fullText += `${currentText} `;
          currentText = '';
        }
        continue;
      }

      const match = line.match(timeRegex);
      if (match) {
        if (currentText && currentTimestamp) {
          segments.push({
            text: currentText,
            startSeconds: currentStartSec,
            timestamp: currentTimestamp,
          });
          fullText += `${currentText} `;
          currentText = '';
        }

        const hrs = parseInt(match[1] || '0', 10);
        const mins = parseInt(match[2], 10);
        const secs = parseInt(match[3], 10);
        currentStartSec = hrs * 3600 + mins * 60 + secs;

        const totalMins = hrs * 60 + mins;
        currentTimestamp = `${totalMins}:${secs.toString().padStart(2, '0')}`;
      } else {
        const clean = this.decodeHtmlEntities(line.replace(/<[^>]*>/g, ''));
        if (clean) {
          currentText = currentText ? `${currentText} ${clean}` : clean;
        }
      }
    }

    if (currentText && currentTimestamp) {
      segments.push({
        text: currentText,
        startSeconds: currentStartSec,
        timestamp: currentTimestamp,
      });
      fullText += `${currentText} `;
    }

    if (segments.length === 0 || fullText.trim().length === 0) return null;
    return { fullText: fullText.trim(), segments };
  }

  /**
   * Decode HTML entities & normalize multi-spaces/newlines
   */
  private decodeHtmlEntities(text: string): string {
    if (!text) return '';
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#xa0;/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
      .replace(/\r?\n/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}


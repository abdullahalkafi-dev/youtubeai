import { Injectable, Logger } from '@nestjs/common';

// Safely require youtube-transcript to avoid Node16 ESM/CJS type resolution mismatch in Docker
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { YoutubeTranscript } = require('youtube-transcript');

export interface TranscriptSegment {
  text: string;
  startSeconds: number;
  timestamp: string; // "MM:SS" or "HH:MM:SS"
}

@Injectable()
export class YouTubeTranscriptService {
  private readonly logger = new Logger(YouTubeTranscriptService.name);

  /**
   * Fetch public video transcript with timestamps (0 YouTube API quota cost)
   */
  async getTranscript(youtubeVideoId: string): Promise<{
    fullText: string;
    segments: TranscriptSegment[];
  } | null> {
    try {
      this.logger.log(`Fetching 0-quota transcript for video: ${youtubeVideoId}`);
      const raw = await YoutubeTranscript.fetchTranscript(youtubeVideoId);
      if (!raw || raw.length === 0) return null;

      const segments: TranscriptSegment[] = [];
      let fullText = '';

      for (const item of raw) {
        const rawOffset = (item as any).offset ?? (item as any).start ?? 0;
        const totalSec = Math.floor(rawOffset > 10000 ? rawOffset / 1000 : rawOffset);

        const mins = Math.floor(totalSec / 60);
        const secs = totalSec % 60;
        const timestamp = `${mins}:${secs.toString().padStart(2, '0')}`;

        const cleanText = (item.text || '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .trim();

        if (cleanText) {
          segments.push({
            text: cleanText,
            startSeconds: totalSec,
            timestamp,
          });
          fullText += `${cleanText} `;
        }
      }

      this.logger.log(`Fetched transcript for ${youtubeVideoId}: ${segments.length} segments, ${fullText.length} chars`);
      return { fullText: fullText.trim(), segments };
    } catch (error: any) {
      this.logger.warn(`Could not fetch transcript for ${youtubeVideoId}: ${error.message}`);
      return null;
    }
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
   * Parse raw VTT or SRT caption file content downloaded from official YouTube Captions API
   * into structured TranscriptSegments.
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
        const clean = line
          .replace(/<[^>]*>/g, '') // remove inline VTT style tags
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .trim();
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

    if (segments.length === 0) return null;
    return { fullText: fullText.trim(), segments };
  }
}

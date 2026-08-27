import { Injectable, Logger } from '@nestjs/common';

export interface TranscriptSegment {
  text: string;
  startSeconds: number;
  timestamp: string; // "MM:SS" or "HH:MM:SS"
}

export type TranscriptSource = 'transcriptapi' | 'innertube_android' | 'innertube_ios' | 'innertube_web' | 'official_oauth' | 'none';

const TRANSCRIPT_API_BASE_URL = 'https://transcriptapi.com/api/v2/youtube/transcript';
const DEFAULT_TRANSCRIPT_API_KEY = process.env.TRANSCRIPT_API_KEY || 'sk_PRPhLwEm-wfc9mN92KUP_1tcTcZeGZmI3gzPDxU-LKI';

@Injectable()
export class YouTubeTranscriptService {
  private readonly logger = new Logger(YouTubeTranscriptService.name);

  /**
   * Fetch video transcript via TranscriptAPI.com (0 YouTube Data API quota cost)
   */
  async getTranscript(youtubeVideoId: string): Promise<{
    fullText: string;
    segments: TranscriptSegment[];
    source: TranscriptSource;
  } | null> {
    const apiKey = process.env.TRANSCRIPT_API_KEY || DEFAULT_TRANSCRIPT_API_KEY;
    const url = `${TRANSCRIPT_API_BASE_URL}?video_url=${youtubeVideoId}&format=json&include_timestamp=true`;

    this.logger.log(`Fetching transcript for video ${youtubeVideoId} via TranscriptAPI.com`);

    // Retry loop: 3 attempts with exponential backoff for network / 408 / 5xx responses
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(15000),
        });

        if (res.status === 200) {
          const data: any = await res.json();
          if (data && Array.isArray(data.transcript) && data.transcript.length > 0) {
            const segments: TranscriptSegment[] = [];
            let fullText = '';

            for (const item of data.transcript) {
              const rawSec = typeof item.start === 'number' ? item.start : parseFloat(item.start) || 0;
              const totalSec = Math.floor(rawSec);

              const hrs = Math.floor(totalSec / 3600);
              const mins = Math.floor((totalSec % 3600) / 60);
              const secs = totalSec % 60;
              const timestamp =
                hrs > 0
                  ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
                  : `${mins}:${secs.toString().padStart(2, '0')}`;

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

            if (segments.length > 0 && fullText.trim().length > 0) {
              this.logger.log(`[TranscriptAPI Success] Ingested ${segments.length} segments (${fullText.trim().length} chars) for video ${youtubeVideoId}`);
              return {
                fullText: fullText.trim(),
                segments,
                source: 'transcriptapi',
              };
            }
          }
        } else if (res.status === 404) {
          this.logger.warn(`TranscriptAPI returned 404 (no transcript available) for video ${youtubeVideoId}`);
          return null;
        } else {
          this.logger.warn(`TranscriptAPI attempt ${attempt}/3 returned HTTP ${res.status} for ${youtubeVideoId}`);
        }
      } catch (err: any) {
        this.logger.warn(`TranscriptAPI attempt ${attempt}/3 error for ${youtubeVideoId}: ${err.message}`);
      }

      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }

    this.logger.warn(`TranscriptAPI could not fetch transcript for ${youtubeVideoId} after 3 attempts`);
    return null;
  }

  /**
   * Sample rich transcript context (~1,500–2,000 tokens) for OpenAI prompt.
   * Includes:
   * 1. Detailed Opening Hook (First 2-3 minutes) for intro hook & premise detection.
   * 2. 35-45 evenly spaced milestone anchors across runtime for accurate chapter timestamps.
   */
  formatTranscriptAnchors(segments: TranscriptSegment[]): string {
    if (!segments || segments.length === 0) return '';

    // 1. Opening Hook Focus (first ~150 seconds / 2.5 minutes)
    const openingSegments = segments.filter((s) => s.startSeconds <= 150).slice(0, 8);
    const hookLines = openingSegments.map((s) => `[${s.timestamp}] "${s.text}"`);

    // 2. Milestone Timeline across the rest of the video (~35-40 points)
    const remainingSegments = segments.filter((s) => s.startSeconds > 150);
    const milestoneLines: string[] = [];

    if (remainingSegments.length > 0) {
      const targetMilestones = 38;
      const step = Math.max(1, Math.floor(remainingSegments.length / targetMilestones));

      for (let i = 0; i < remainingSegments.length; i += step) {
        const s = remainingSegments[i];
        if (s) {
          milestoneLines.push(`[${s.timestamp}] "${s.text}"`);
        }
        if (milestoneLines.length >= targetMilestones) break;
      }
    }

    const sections: string[] = [];
    if (hookLines.length > 0) {
      sections.push(`=== OPENING HOOK (FIRST 2-3 MINUTES) ===\n${hookLines.join('\n')}`);
    }
    if (milestoneLines.length > 0) {
      sections.push(`=== TIMELINE MILESTONES (FOR ACCURATE CHAPTER TIMESTAMPS) ===\n${milestoneLines.join('\n')}`);
    }

    return sections.join('\n\n');
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
        currentTimestamp =
          hrs > 0
            ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
            : `${totalMins}:${secs.toString().padStart(2, '0')}`;
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

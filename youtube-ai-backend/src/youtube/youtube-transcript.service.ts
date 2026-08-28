import { Injectable, Logger } from '@nestjs/common';

export interface TranscriptSegment {
  text: string;
  startSeconds: number;
  timestamp: string; // "MM:SS" or "HH:MM:SS"
}

export type TranscriptSource = 'transcriptapi' | 'innertube_android' | 'innertube_ios' | 'innertube_web' | 'official_oauth' | 'none';

const TRANSCRIPT_API_BASE_URL = 'https://transcriptapi.com/api/v2/youtube';
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

    this.logger.log(`Fetching transcript for video ${youtubeVideoId} via TranscriptAPI.com`);

    // 1. Free Pre-flight check via /youtube/info (detects if video has subtitles with 0 credit cost)
    try {
      const infoUrl = `${TRANSCRIPT_API_BASE_URL}/info?video_url=${youtubeVideoId}`;
      const infoRes = await fetch(infoUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });

      if (infoRes.status === 404) {
        this.logger.warn(`[TranscriptAPI Info] Video ${youtubeVideoId} has no transcript tracks on YouTube`);
        return null;
      }
    } catch {
      // Proceed if pre-flight times out
    }

    // 2. Fetch transcript with timestamps
    const url = `${TRANSCRIPT_API_BASE_URL}/transcript?video_url=${youtubeVideoId}&format=json&include_timestamp=true`;

    // Retry loop: 3 attempts with backoff for network / 408 / 5xx responses
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(20000),
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
   * Sample rich transcript context for OpenAI prompt with dynamic duration-aware chapter anchors.
   * Includes:
   * 1. Opening Hook & Narrative Premise (First 2 minutes of spoken context).
   * 2. 5-15 evenly spaced milestone anchors (spaced 1-3+ minutes apart) based on video runtime.
   */
  formatTranscriptAnchors(segments: TranscriptSegment[]): string {
    if (!segments || segments.length === 0) return '';

    // 1. Opening Narrative Hook Context (First ~120 seconds / 2 minutes)
    const openingSegments = segments.filter((s) => s.startSeconds <= 120);
    const openingText = openingSegments.map((s) => s.text.trim()).filter(Boolean).join(' ');

    // Total runtime duration calculation
    const totalSeconds = segments[segments.length - 1]?.startSeconds || 600;
    const durationMinutes = Math.max(1, totalSeconds / 60);

    // Dynamic milestone target based on video runtime:
    // < 10 mins: 5-8 chapters (min interval 60s)
    // 10-25 mins: 8-12 chapters (min interval 90s)
    // > 25 mins: 12-15 chapters (min interval 120s)
    let targetMilestones = 10;
    let minIntervalSeconds = 90;

    if (durationMinutes < 10) {
      targetMilestones = Math.min(8, Math.max(5, Math.floor(durationMinutes * 0.8)));
      minIntervalSeconds = 60;
    } else if (durationMinutes <= 25) {
      targetMilestones = Math.min(12, Math.max(8, Math.floor(durationMinutes / 2)));
      minIntervalSeconds = 90;
    } else {
      targetMilestones = Math.min(15, Math.max(12, Math.floor(durationMinutes / 2.5)));
      minIntervalSeconds = 120;
    }

    // 2. Sample milestones evenly starting after intro (~60s onwards)
    const milestoneLines: string[] = [];
    const stepSeconds = (totalSeconds - 60) / Math.max(1, targetMilestones);

    let lastSelectedSeconds = -999;
    for (let m = 1; m <= targetMilestones; m++) {
      const targetTime = 60 + (m - 0.5) * stepSeconds;
      // Find closest segment to targetTime
      const candidate = segments.find(
        (s) => s.startSeconds >= targetTime && s.startSeconds - lastSelectedSeconds >= minIntervalSeconds
      ) || segments.find((s) => Math.abs(s.startSeconds - targetTime) <= 45 && s.startSeconds - lastSelectedSeconds >= minIntervalSeconds);

      if (candidate && candidate.startSeconds - lastSelectedSeconds >= minIntervalSeconds) {
        milestoneLines.push(`[${candidate.timestamp}] "${candidate.text.trim()}"`);
        lastSelectedSeconds = candidate.startSeconds;
      }
    }

    const sections: string[] = [];
    if (openingText) {
      sections.push(`=== INTRO HOOK & PREMISE (FIRST 2 MINUTES) ===\n"${openingText.substring(0, 1000)}"`);
    }
    if (milestoneLines.length > 0) {
      sections.push(
        `=== TIMELINE MILESTONES (SELECT 5 TO 15 HIGH-RETENTION CHAPTERS SPACED 1-3 MIN APART) ===\nVideo Duration: ~${Math.round(durationMinutes)} minutes\n${milestoneLines.join('\n')}`
      );
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

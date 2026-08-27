import mongoose, { Schema } from 'mongoose';

// Ensure dotenv is loaded if run standalone
require('dotenv').config();

const DEFAULT_MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/youtube_ai';
const DEFAULT_TRANSCRIPT_API_KEY = process.env.TRANSCRIPT_API_KEY || 'sk_PRPhLwEm-wfc9mN92KUP_1tcTcZeGZmI3gzPDxU-LKI';
const TRANSCRIPT_API_BASE_URL = 'https://transcriptapi.com/api/v2/youtube/transcript';
const DELAY_BETWEEN_REQUESTS_MS = 2000; // 30 requests per minute (polite pacing)

// Define minimal Video schema for the migration script
const VideoSchema = new Schema(
  {
    youtubeId: { type: String, required: true },
    title: { type: String },
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel' },
    deletedFromYoutube: { type: Boolean, default: false },
    transcriptText: { type: String },
    transcriptSegments: { type: [Object], default: [] },
    transcriptSource: { type: String },
    transcriptFetchedAt: { type: Date },
  },
  { collection: 'videos', strict: false },
);

const VideoModel = mongoose.model('VideoMigration', VideoSchema);

interface TranscriptApiItem {
  text: string;
  start: number;
  duration: number;
}

function decodeHtmlEntities(text: string): string {
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

async function fetchFromTranscriptApi(youtubeId: string, apiKey: string): Promise<{
  status: 'success' | 'none' | 'error';
  fullText?: string;
  segments?: Array<{ text: string; startSeconds: number; timestamp: string }>;
  error?: string;
}> {
  const url = `${TRANSCRIPT_API_BASE_URL}?video_url=${youtubeId}&format=json&include_timestamp=true`;

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
          const segments: Array<{ text: string; startSeconds: number; timestamp: string }> = [];
          let fullText = '';

          for (const item of data.transcript as TranscriptApiItem[]) {
            const rawSec = typeof item.start === 'number' ? item.start : parseFloat(String(item.start)) || 0;
            const totalSec = Math.floor(rawSec);

            const hrs = Math.floor(totalSec / 3600);
            const mins = Math.floor((totalSec % 3600) / 60);
            const secs = totalSec % 60;
            const timestamp =
              hrs > 0
                ? `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
                : `${mins}:${secs.toString().padStart(2, '0')}`;

            const cleanText = decodeHtmlEntities(item.text || '');

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
            return {
              status: 'success',
              fullText: fullText.trim(),
              segments,
            };
          }
        }
      } else if (res.status === 404) {
        return { status: 'none', error: '404 - No transcript available' };
      } else {
        // 408 / 5xx error
        if (attempt === 3) {
          return { status: 'error', error: `HTTP ${res.status}` };
        }
      }
    } catch (e: any) {
      if (attempt === 3) {
        return { status: 'error', error: e.message };
      }
    }

    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  return { status: 'error', error: 'Max attempts reached' };
}

async function runMigration() {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let channelFilter: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
    }
    if (args[i] === '--channel' && args[i + 1]) {
      channelFilter = args[i + 1];
    }
  }

  const mongoUri = process.env.MONGODB_URI || DEFAULT_MONGO_URI;
  const apiKey = process.env.TRANSCRIPT_API_KEY || DEFAULT_TRANSCRIPT_API_KEY;

  console.log(`\n===============================================================`);
  console.log(`🚀 STARTING TRANSCRIPT MIGRATION VIA TRANSCRIPTAPI.COM`);
  console.log(`===============================================================`);
  console.log(`• MongoDB URI: ${mongoUri.replace(/:([^@]+)@/, ':****@')}`);
  console.log(`• Target Pacing: 30 requests/minute (1 req / ${DELAY_BETWEEN_REQUESTS_MS}ms)`);
  console.log(`• Limit: ${limit ? `${limit} videos` : 'ALL unprocessed videos'}`);
  console.log(`• Zero YouTube Data API calls: 100% Isolated to TranscriptAPI.com\n`);

  await mongoose.connect(mongoUri);
  console.log(`✅ Connected to MongoDB successfully.\n`);

  // Query: Find all videos that do NOT have transcriptSegments yet and are not marked as deleted
  const query: any = {
    deletedFromYoutube: { $ne: true },
    $or: [
      { transcriptSegments: { $exists: false } },
      { transcriptSegments: { $size: 0 } },
      { transcriptSegments: null },
    ],
    transcriptSource: { $ne: 'none' },
  };

  if (channelFilter) {
    query.channelId = new mongoose.Types.ObjectId(channelFilter);
  }

  const totalCandidates = await VideoModel.countDocuments(query);
  console.log(`📊 Found ${totalCandidates} candidate videos needing transcript ingestion.`);

  if (totalCandidates === 0) {
    console.log(`✨ All videos in database already have transcripts! Nothing to do.`);
    await mongoose.disconnect();
    return;
  }

  let dbQuery = VideoModel.find(query).select('_id youtubeId title channelId').sort({ publishedAt: -1 });
  if (limit && limit > 0) {
    dbQuery = dbQuery.limit(limit);
  }

  const cursor = dbQuery.cursor({ batchSize: 20 });

  let processedCount = 0;
  let successCount = 0;
  let noneCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  for await (const doc of cursor) {
    processedCount++;
    const vid = doc as any;
    const progressPrefix = `[${processedCount}/${limit || totalCandidates}]`;

    if (!vid.youtubeId) {
      console.log(`${progressPrefix} ⚠️ Skipping doc ${vid._id} (no youtubeId)`);
      continue;
    }

    const result = await fetchFromTranscriptApi(vid.youtubeId, apiKey);

    if (result.status === 'success' && result.segments && result.fullText) {
      await VideoModel.findByIdAndUpdate(vid._id, {
        $set: {
          transcriptText: result.fullText,
          transcriptSegments: result.segments,
          transcriptSource: 'transcriptapi',
          transcriptFetchedAt: new Date(),
        },
      });
      successCount++;
      console.log(`${progressPrefix} ✅ Saved ${result.segments.length} segments for ${vid.youtubeId} ("${(vid.title || '').slice(0, 40)}")`);
    } else if (result.status === 'none') {
      await VideoModel.findByIdAndUpdate(vid._id, {
        $set: {
          transcriptSource: 'none',
          transcriptFetchedAt: new Date(),
        },
      });
      noneCount++;
      console.log(`${progressPrefix} ℹ️ No transcript on YouTube for ${vid.youtubeId} (marked as none)`);
    } else {
      errorCount++;
      console.log(`${progressPrefix} ❌ Error for ${vid.youtubeId}: ${result.error || 'unknown'}`);
    }

    // Pacing: Wait 2,000ms before next request (30 req/min)
    await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_REQUESTS_MS));
  }

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  const elapsedMins = (elapsedSec / 60).toFixed(1);

  console.log(`\n===============================================================`);
  console.log(`🎉 TRANSCRIPT MIGRATION BATCH COMPLETE`);
  console.log(`===============================================================`);
  console.log(`• Total Processed: ${processedCount}`);
  console.log(`• Successfully Ingested: ${successCount} videos`);
  console.log(`• Confirmed No Subtitles: ${noneCount} videos`);
  console.log(`• Failed / Retried Later: ${errorCount} videos`);
  console.log(`• Total Duration: ${elapsedSec}s (~${elapsedMins} mins)`);
  console.log(`===============================================================\n`);

  await mongoose.disconnect();
}

runMigration().catch((err) => {
  console.error(`💥 Fatal Migration Error:`, err);
  process.exit(1);
});

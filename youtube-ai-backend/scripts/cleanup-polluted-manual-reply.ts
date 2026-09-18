/**
 * Dry-run cleanup for polluted automation batch items.
 *
 * Production-safe by default:
 *   DRY_RUN=true (default)  — report only, no writes
 *   DRY_RUN=false           — clear manualReplyText only on strict matches
 *
 * Strict clear filter (all must match):
 *   - automation_batches type = comment_reply
 *   - item.status = completed
 *   - item.manualReplyText is set/non-empty
 *   - item.generatedReply is set/non-empty
 *   - item.manualReplyText === item.generatedReply (exact same AI text)
 *
 * Never touches:
 *   - handled_manually items (true creator replies)
 *   - completed items where manual text differs from AI text
 *   - skipped / failed items
 *
 * Usage (from youtube-ai-backend):
 *   npx ts-node -r tsconfig-paths/register scripts/cleanup-polluted-manual-reply.ts
 *   DRY_RUN=false npx ts-node -r tsconfig-paths/register scripts/cleanup-polluted-manual-reply.ts
 *
 * Requires MONGODB_URI (defaults to local like other scripts).
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27019/youtube_ai';
const DRY_RUN = String(process.env.DRY_RUN ?? 'true').toLowerCase() !== 'false';
const SAMPLE_LIMIT = parseInt(process.env.SAMPLE_LIMIT || '15', 10);
const CHUNK_LIMIT = parseInt(process.env.CHUNK_LIMIT || '200', 10);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

async function main() {
  console.log('=== Auto-comment manualReply pollution cleanup ===');
  console.log(`Mongo: ${MONGODB_URI}`);
  console.log(`Mode:  ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE WRITE'}`);

  await mongoose.connect(MONGODB_URI);
  const batches = mongoose.connection.db!.collection('automation_batches');

  // Read-only scan of comment_reply batches with any completed items that have manualReplyText
  const cursor = batches.find(
    {
      type: 'comment_reply',
      'items.status': 'completed',
      'items.manualReplyText': { $exists: true, $nin: [null, ''] },
    },
    {
      projection: {
        _id: 1,
        channelId: 1,
        createdAt: 1,
        items: 1,
      },
    },
  );

  let scannedBatches = 0;
  let pollutedItemCount = 0;
  let safeManualKept = 0;
  let mismatchCompletedKept = 0;
  const polluted: Array<{
    batchId: string;
    itemIndex: number;
    commentId?: string;
    youtubeId?: string;
    title?: string;
    status?: string;
    generatedReply?: string;
    manualReplyText?: string;
  }> = [];

  const updateOps: Array<{
    updateOne: {
      filter: Record<string, unknown>;
      update: { $unset: Record<string, string> };
    };
  }> = [];

  for await (const batch of cursor) {
    scannedBatches++;
    const items = Array.isArray(batch.items) ? batch.items : [];

    items.forEach((item: any, index: number) => {
      const status = item?.status;
      const manual = item?.manualReplyText;
      const generated = item?.generatedReply;

      if (status === 'handled_manually' && isNonEmptyString(manual)) {
        safeManualKept++;
        return;
      }

      if (status !== 'completed' || !isNonEmptyString(manual)) {
        return;
      }

      if (!isNonEmptyString(generated)) {
        // completed + manual but no AI text — leave alone (unclear)
        mismatchCompletedKept++;
        return;
      }

      if (manual !== generated) {
        // different texts on completed — leave alone
        mismatchCompletedKept++;
        return;
      }

      // Strict pollution: completed AI item with identical manualReplyText
      pollutedItemCount++;
      polluted.push({
        batchId: String(batch._id),
        itemIndex: index,
        commentId: item?.commentId,
        youtubeId: item?.youtubeId,
        title: item?.originalTitle,
        status,
        generatedReply: generated,
        manualReplyText: manual,
      });

      updateOps.push({
        updateOne: {
          filter: {
            _id: batch._id,
            // belt-and-suspenders: re-check on write
            'items.status': 'completed',
          },
          update: {
            $unset: {
              [`items.${index}.manualReplyText`]: '',
            },
          },
        },
      });
    });
  }

  console.log('--- Scan summary ---');
  console.log(`Batches scanned (with completed + manualReplyText present): ${scannedBatches}`);
  console.log(`Polluted items (completed + manual === generated): ${pollutedItemCount}`);
  console.log(`True manual items kept (handled_manually): ${safeManualKept}`);
  console.log(`Completed items kept (unclear / different text): ${mismatchCompletedKept}`);

  console.log(`--- Sample (up to ${SAMPLE_LIMIT}) ---`);
  for (const s of polluted.slice(0, SAMPLE_LIMIT)) {
    console.log(
      JSON.stringify(
        {
          batchId: s.batchId,
          itemIndex: s.itemIndex,
          commentId: s.commentId,
          youtubeId: s.youtubeId,
          title: s.title,
          textPreview: (s.generatedReply || '').slice(0, 80),
        },
        null,
        0,
      ),
    );
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN complete. No database writes performed.');
    console.log('Review samples. If all look like false Creator Manual labels on AI replies,');
    console.log('re-run with DRY_RUN=false to clear manualReplyText on strict matches only.');
  } else {
    if (!updateOps.length) {
      console.log('\nLIVE mode: nothing to update.');
    } else {
      console.log(`\nLIVE mode: applying ${updateOps.length} $unset operations in chunks...`);
      let applied = 0;
      for (let i = 0; i < updateOps.length; i += CHUNK_LIMIT) {
        const chunk = updateOps.slice(i, i + CHUNK_LIMIT);
        const result = await batches.bulkWrite(chunk as any, { ordered: false });
        applied += result.modifiedCount || 0;
        console.log(`  chunk ${Math.floor(i / CHUNK_LIMIT) + 1}: modified=${result.modifiedCount}`);
      }
      console.log(`Done. Items modified≈${applied} / planned=${updateOps.length}`);
    }
  }

  await mongoose.disconnect();
  console.log('Cleanup script finished.');
}

main().catch((err) => {
  console.error('Cleanup script failed:', err);
  process.exit(1);
});

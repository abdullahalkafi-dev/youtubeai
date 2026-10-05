/**
 * One-off CTR/impressions backfill — YouTube Reporting API (channel_reach_basic_a1).
 *
 * Usage (inside backend container, uses env MONGODB_URI / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET):
 *   node dist/src/scripts/backfill-ctr.js            # dry-run (prints plan, writes nothing)
 *   node dist/src/scripts/backfill-ctr.js --write    # apply bulkWrite to videos
 *
 * Env:
 *   BACKFILL_DAYS=90   history window in days
 *   BACKFILL_RECENT_DAYS=7  window used for the "fresh" ctr/impressions fields
 *
 * Cost: Reporting API is NOT metered against the 10,000/day Data API quota.
 *       0 OpenAI tokens. ~1 jobs.list + ~1-2 reports.list + N CSV downloads.
 */
import mongoose from 'mongoose';
import { google } from 'googleapis';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
} catch {
  // Docker injects env vars directly
}

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/youtube_ai';
const REACH_REPORT_TYPE = 'channel_reach_basic_a1';
const DAYS = Number(process.env.BACKFILL_DAYS || 90);
const RECENT_DAYS = Number(process.env.BACKFILL_RECENT_DAYS || 7);
const WRITE = process.argv.includes('--write');
const MIN_IMPRESSIONS = 100;

interface Merged {
  impressions: number;
  clicks: number; // impressions * ctrFraction (CTR from Reporting API is 0..1)
  recentImpressions: number;
  recentClicks: number;
  files: number;
}

function findCol(header: string[], aliases: string[]): number {
  const lower = header.map((h) => h.toLowerCase().replace(/^"|"$/g, '').trim());
  for (const alias of aliases) {
    const i = lower.indexOf(alias.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === ',' && !inQ) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

interface Row {
  videoId: string;
  impressions: number;
  clicks: number;
}

function parseReachCsv(csv: string): { rows: Row[]; header: string } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], header: '(empty)' };
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const iDate = findCol(header, ['date', 'day']);
  const iVideo = findCol(header, ['video_id', 'videoid', 'video', 'id']);
  const iImp = findCol(header, ['video_thumbnail_impressions', 'thumbnail_impressions', 'impressions']);
  const iCtr = findCol(header, ['video_thumbnail_impressions_ctr', 'thumbnail_impressions_ctr', 'impressions_ctr', 'ctr']);
  if (iVideo < 0 || iImp < 0 || iCtr < 0) {
    return { rows: [], header: JSON.stringify(header) };
  }
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const videoId = (cols[iVideo] || '').replace(/^"|"$/g, '');
    if (!videoId) continue;
    const impressions = Number(cols[iImp] || 0) || 0;
    const ctrFraction = Number(cols[iCtr] || 0) || 0;
    if (impressions <= 0) continue;
    rows.push({ videoId, impressions, clicks: impressions * ctrFraction });
  }
  return { rows, header: JSON.stringify(header) };
}

async function main() {
  console.log(`\n=== CTR BACKFILL (${WRITE ? 'WRITE MODE' : 'DRY RUN'}) window=${DAYS}d freshWindow=${RECENT_DAYS}d ===`);

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db!;
  const users = db.collection('users');
  const channels = db.collection('channels');
  const videos = db.collection('videos');

  // 1. Resolve OAuth: prefer the owner of the largest channel, else any user with a refreshToken
  const channelDocs = await channels
    .find({}, { projection: { userId: 1, name: 1, youtubeChannelId: 1 } })
    .toArray();
  let refreshToken: string | undefined;
  let userId: any;
  for (const ch of channelDocs) {
    if (!ch.userId) continue;
    const u = await users.findOne({ _id: ch.userId }, { projection: { refreshToken: 1, email: 1 } });
    if (u?.refreshToken) {
      refreshToken = u.refreshToken;
      userId = u._id;
      break;
    }
  }
  if (!refreshToken) {
    const u = await users.findOne({ refreshToken: { $exists: true, $ne: null } }, { projection: { refreshToken: 1 } });
    if (u?.refreshToken) {
      refreshToken = u.refreshToken;
      userId = u._id;
    }
  }
  if (!refreshToken) {
    console.error('FATAL: no user with a Google refreshToken found');
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }
  console.log(`Auth: using user ${String(userId)} refresh token (length ${refreshToken.length})`);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await oauth2Client.refreshAccessToken();
  const accessToken = credentials.access_token;
  if (!accessToken) {
    console.error('FATAL: could not refresh access token');
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }
  // Safety: mirror app behavior — persist rotated refresh tokens so auth never breaks
  if (credentials.refresh_token && credentials.refresh_token !== refreshToken) {
    await users.updateOne({ _id: userId }, { $set: { refreshToken: credentials.refresh_token } });
    console.log('Rotated refresh token persisted to users collection');
  }
  console.log('Access token acquired');

  const youtubereporting = (google as any).youtubereporting || (google as any).youtubeReporting;
  const reporting = youtubereporting({ version: 'v1', auth: oauth2Client });

  // 2. Find the reach job
  const jobsRes = await reporting.jobs.list({ includeSystemManaged: true });
  const jobs = jobsRes.data.jobs || [];
  const job = jobs.find((j: any) => j.reportTypeId === REACH_REPORT_TYPE);
  if (!job?.id) {
    console.error(`FATAL: no ${REACH_REPORT_TYPE} job. Jobs: ${jobs.map((j: any) => j.reportTypeId).join(', ') || 'none'}`);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }
  console.log(`Job: ${job.id} type=${job.reportTypeId} created=${job.createTime || 'unknown'}`);

  // 3. List ALL report files (paginated)
  const allReports: any[] = [];
  let pageToken: string | undefined;
  do {
    const res: any = await reporting.jobs.reports.list({
      jobId: job.id,
      pageSize: 100,
      pageToken,
    });
    allReports.push(...(res.data.reports || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken && allReports.length < 1000);

  const cutoffMs = Date.now() - DAYS * 24 * 60 * 60 * 1000;
  const recentCutoffMs = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const usable = allReports
    .filter((r) => r.downloadUrl && new Date(r.startTime || 0).getTime() >= cutoffMs)
    .sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')));

  console.log(`Reports total=${allReports.length} in-window(${DAYS}d)=${usable.length}`);
  if (allReports.length) {
    console.log(
      `History range: ${allReports[allReports.length - 1].startTime} .. ${allReports[0].startTime}`,
    );
  }

  // File-per-day structure: multiple files for the same day would double-count on naive sum
  const byDate = new Map<string, number>();
  for (const r of usable) {
    const day = String(r.startTime || '').slice(0, 10);
    byDate.set(day, (byDate.get(day) || 0) + 1);
  }
  const dateList = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  console.log(
    `Distinct days=${dateList.length} files/day: ${dateList.map(([d, n]) => `${d}:${n}`).join(' ')}`,
  );

  // Dedupe: some days have 2 report files (reissues). Keep the LAST file per day
  // (YouTube Reporting reissues are full replacements) so impressions never double-count.
  const deduped = new Map<string, any>();
  for (const r of usable) deduped.set(String(r.startTime || ''), r);
  const filesToDownload = [...deduped.values()];
  console.log(`Files after day-dedupe: ${filesToDownload.length} (dropped ${usable.length - filesToDownload.length} reissues)`);

  if (process.argv.includes('--list')) {
    console.log('LIST MODE — exiting before downloads.');
    for (const r of filesToDownload.slice(0, 15)) {
      console.log(`  ${r.id} start=${r.startTime} end=${r.endTime}`);
    }
    await mongoose.disconnect();
    return;
  }

  // --headers: dump header line of the newest file for every report type
  if (process.argv.includes('--headers')) {
    const allJobs: any[] = [];
    let jp: string | undefined;
    do {
      const jr: any = await reporting.jobs.list({ includeSystemManaged: true, pageSize: 100, pageToken: jp });
      allJobs.push(...(jr.data.jobs || []));
      jp = jr.data.nextPageToken;
    } while (jp);
    console.log(`\n=== REPORT TYPE HEADERS (${allJobs.length} jobs) ===`);
    for (const j of allJobs) {
      try {
        const rr: any = await reporting.jobs.reports.list({ jobId: j.id, pageSize: 3 });
        const newest = (rr.data.reports || []).filter((r: any) => r.downloadUrl)[0];
        if (!newest) {
          console.log(`${j.reportTypeId}: no files`);
          continue;
        }
        const res = await fetch(newest.downloadUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        const text = await res.text();
        const firstLine = text.split(/\r?\n/)[0] || '';
        console.log(`${j.reportTypeId} [${newest.startTime}]: ${firstLine}`);
      } catch (e: any) {
        console.log(`${j.reportTypeId}: ERROR ${e?.message || e}`);
      }
    }
    await mongoose.disconnect();
    return;
  }

  // --diffday YYYY-MM-DD: compare duplicate files for one day (split vs reissue)
  const diffDay = process.argv.find((a, i) => process.argv[i - 1] === '--diffday');
  if (diffDay) {
    const pair = usable.filter((r) => String(r.startTime || '').startsWith(diffDay));
    console.log(`\nDIFFDAY ${diffDay}: ${pair.length} file(s)`);
    const perFile: Array<{ id: string; rows: number; totalImp: number; sample: Row[] }> = [];
    for (const report of pair) {
      const res = await fetch(report.downloadUrl!, { headers: { Authorization: `Bearer ${accessToken}` } });
      const { rows } = parseReachCsv(await res.text());
      const totalImp = rows.reduce((s, r) => s + r.impressions, 0);
      perFile.push({
        id: report.id,
        rows: rows.length,
        totalImp,
        sample: rows.filter((r) => ['97po3YZ6ZEw', 'pU1mJcc91EA'].includes(r.videoId)),
      });
      console.log(`  file=${report.id} rows=${rows.length} totalImp=${totalImp}`);
      for (const s of perFile[perFile.length - 1].sample) {
        console.log(`     ${s.videoId}: imp=${s.impressions} clicks=${s.clicks.toFixed(2)}`);
      }
    }
    if (perFile.length === 2) {
      const a = pair[0], b = pair[1];
      console.log(
        `VERDICT hint: identical-range=${String(a.startTime) === String(b.startTime) && String(a.endTime) === String(b.endTime)}`,
      );
    }
    await mongoose.disconnect();
    return;
  }
  if (!usable.length) {
    console.error('FATAL: no report files in window');
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  // 4. Download + merge
  const merged = new Map<string, Merged>();
  let ok = 0;
  let failed = 0;
  let firstHeader = '';
  for (const report of filesToDownload) {
    try {
      const res = await fetch(report.downloadUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) {
        failed++;
        continue;
      }
      const text = await res.text();
      const { rows, header } = parseReachCsv(text);
      if (!firstHeader) firstHeader = header;
      const isRecent = new Date(report.startTime || 0).getTime() >= recentCutoffMs;
      for (const row of rows) {
        let m = merged.get(row.videoId);
        if (!m) {
          m = { impressions: 0, clicks: 0, recentImpressions: 0, recentClicks: 0, files: 0 };
          merged.set(row.videoId, m);
        }
        m.impressions += row.impressions;
        m.clicks += row.clicks;
        if (isRecent) {
          m.recentImpressions += row.impressions;
          m.recentClicks += row.clicks;
        }
        m.files++;
      }
      ok++;
    } catch {
      failed++;
    }
  }
  console.log(`Downloaded ${ok}/${filesToDownload.length} files (failed ${failed})`);
  if (!ok) {
    console.error(`FATAL: no files downloaded. First header: ${firstHeader}`);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  // 5. Join with catalog
  const videoDocs = await videos
    .find({}, { projection: { youtubeId: 1, channelId: 1, publishedAt: 1, ctr: 1, impressions: 1 } })
    .toArray();
  const byYoutubeId = new Map<string, (typeof videoDocs)[number]>();
  for (const v of videoDocs) if (v.youtubeId) byYoutubeId.set(v.youtubeId, v);

  const now = new Date();
  const ops: any[] = [];
  let matched = 0;
  let freshQualified = 0;
  let lifetimeQualified = 0;
  const freshRows: Array<{ id: string; title?: string; ctr: number; imp: number }> = [];

  for (const [videoId, m] of merged.entries()) {
    const doc = byYoutubeId.get(videoId);
    if (!doc) continue;
    matched++;

    const lifetimeCtr = m.impressions > 0 ? Math.round((m.clicks / m.impressions) * 10000) / 100 : 0;
    const freshCtr = m.recentImpressions > 0 ? Math.round((m.recentClicks / m.recentImpressions) * 10000) / 100 : 0;

    const set: any = {
      lifetimeCtr,
      lifetimeImpressions: m.impressions,
      performanceSyncedAt: now,
    };
    if (m.recentImpressions >= MIN_IMPRESSIONS) {
      set.ctr = freshCtr;
      set.impressions = m.recentImpressions;
      freshQualified++;
      freshRows.push({ id: videoId, ctr: freshCtr, imp: m.recentImpressions });
    }
    if (m.impressions >= MIN_IMPRESSIONS) lifetimeQualified++;

    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
  }

  console.log(`\nCatalog videos=${videoDocs.length} report rows matched=${matched} unmatchedReportVideos=${merged.size - matched}`);
  console.log(`Fresh(${RECENT_DAYS}d) window with >=${MIN_IMPRESSIONS} imp: ${freshQualified}`);
  console.log(`Lifetime(${DAYS}d) with >=${MIN_IMPRESSIONS} imp: ${lifetimeQualified}`);

  // Baseline from lifetime (most stable for reporting)
  let impSum = 0;
  let clickSum = 0;
  for (const [videoId, m] of merged.entries()) {
    if (!byYoutubeId.has(videoId) || m.impressions < MIN_IMPRESSIONS) continue;
    impSum += m.impressions;
    clickSum += m.clicks;
  }
  const baseline = impSum > 0 ? Math.round((clickSum / impSum) * 10000) / 100 : 0;
  console.log(`Channel baseline CTR (impression-weighted, ${DAYS}d, imp>=${MIN_IMPRESSIONS}): ${baseline}%`);

  freshRows.sort((a, b) => b.ctr - a.ctr);
  console.log(`\nTop 5 fresh CTR:`);
  freshRows.slice(0, 5).forEach((r, i) => console.log(`  ${i + 1}. ${r.id}  CTR ${r.ctr}%  imp ${r.imp}`));
  console.log(`Bottom 5 fresh CTR:`);
  freshRows.slice(-5).forEach((r) => console.log(`  - ${r.id}  CTR ${r.ctr}%  imp ${r.imp}`));

  if (!WRITE) {
    console.log(`\nDRY RUN — no writes. Would update ${ops.length} videos. Re-run with --write to apply.`);
    await mongoose.disconnect();
    return;
  }

  // 6. Apply in chunks
  let updated = 0;
  const CHUNK = 500;
  for (let i = 0; i < ops.length; i += CHUNK) {
    const chunk = ops.slice(i, i + CHUNK);
    const res = await videos.bulkWrite(chunk, { ordered: false });
    updated += res.modifiedCount || 0;
  }
  console.log(`\nDONE — updated ${updated}/${ops.length} videos`);

  const withCtr = await videos.countDocuments({ ctr: { $gt: 0 } });
  const withLifetime = await videos.countDocuments({ lifetimeCtr: { $gt: 0 } });
  console.log(`Verify: videos with ctr>0 = ${withCtr} (was 4), lifetimeCtr>0 = ${withLifetime}`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('FATAL:', err?.message || err);
  process.exit(1);
});

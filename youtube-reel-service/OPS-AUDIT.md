# Reel pipeline — developer audit guide

Start here when checking whether the daily reels are healthy. Everything in this file is **developer-only**: the client's app never
shows warnings, technical errors or AI working notes (decision 2026-11-05: technical failures confuse and upset the client). Problems are
recorded for us and the pipeline heals itself where it can.

## 1. Read the daily health record

Each New York day gets one row in Mongo `reel_ops_reports` (written at 12:00 and 23:50 New York by the worker).

```bash
ssh root@2.24.105.72
docker exec youtubeai-reels-reel-worker-1 node dist/cli/reel-cli.js ops:report 7           # last 7 days, one block each
docker exec youtubeai-reels-reel-worker-1 node dist/cli/reel-cli.js ops:report --build      # refresh today now, then print
docker exec youtubeai-reels-reel-worker-1 node dist/cli/reel-cli.js ops:report --build 2026-11-03 --json   # one past day, all fields
```

Each block starts `=== <date>: <made>/<target> reels | <lane> <reels>/<asked> <status>…`, then one `!` line per issue. "ok: no issues"
is a healthy day. The `body` of a row holds the details:

| field | meaning |
|---|---|
| `target`, `made` | reels the day should end with (5, the posting plan's slots) and reels its daily campaigns made |
| `run` | main topic, topics that failed and were replaced (`fallbacks`), and whether the backup campaign ran |
| `topics[].footage` | mined moments that **name the topic's person**. 0 means the host never discussed them |
| `campaigns[]` | every daily campaign: lane (`main`, `fresh` = new videos, `bank`/`best` = older footage), reels, status, error, `autoTopup` |
| `stuckSources` | videos sitting in an analysis stage for over 3 hours |
| `failedSources` | videos that could not be downloaded or analyzed today (often "Video unavailable") |
| `downloads.heights` | resolution of today's downloads. All 360p = the YouTube session needs fresh cookies |
| `session` | yt-dlp session status, cookie age and the last check error |
| `renders` | failed renders, and reels that fell back to the classic look (with ffmpeg's real reason) |
| `stock` | finished unposted reels, queued posts, days of posting left |
| `posting` | posts published today and failed posts with their error code |
| `wasted` | prompt tokens and speech-to-text minutes spent on campaigns that made no reel |

## 2. What heals itself (no action needed)

- **Topic choice uses real footage.** A topic about a person counts only mined moments that name that person
  (`entityPattern` in `pipeline/daily-brain.ts`). The topic's best passages (`anchors`) are given to the campaign as seed videos, so the
  search cannot miss them.
- **Failed main topic → next topic** (up to 2), ranked by the same real-footage count.
- **Daily floor** (`DailyService.superviseDay`, every 10 minutes): once every daily campaign has settled and the day has fewer than 5
  reels, each partial campaign with unreviewed moments is topped up once; after that one backup campaign (`best` lane) is made from the
  analyzed videos with the most strong unused footage.
- **No-topic day:** the new-videos and older-videos lanes still run.
- **New-videos lane** rests the videos it used on the last 2 days and puts uploads from the last 3 days first.
- **Stuck videos** (in downloaded / transcribing / mining for over 3 hours with no job) are restarted up to 3 times, then marked failed
  with the reason.
- **Aired premieres still flagged "upcoming"** are usable in both the lanes and the topic search (`isSourceable`).
- **Full-screen render error →** the reel is made in the classic look; `lookNote` keeps ffmpeg's actual error lines.

## 3. What needs a person

| issue line | what to do |
|---|---|
| "downloads today were below 720p" / "session check is failing" / "cookies are N days old" | export fresh YouTube cookies from the burner account and paste or upload them in the app: Settings → "Reel downloader" → Replace cookies (it tests them before saving). `cookies:import <file>` in the worker container still works as a fallback |
| "stuck in … for Nh" that keeps coming back | check `docker logs youtubeai-reels-reel-worker-1` for that youtubeId; after 3 restarts it is marked failed |
| "fell back to the classic look" | read the ffmpeg reason in the report; reproduce with `look:test <youtubeId> <start> <duration> <outDir>` |
| "Low stock" for several days | the topic lanes are not producing: look at `topics[].footage` and the campaign errors |
| "post(s) failed" | the post's `errorCode` (quota, auth) in `reel_posts` |

## 4. Background: the Nov 1–4, 2026 failure

Main topics were chosen on keyword counts (`"son"`, `"charges"`, `"prison"`), so "Boosie's Son" claimed 293 moments with 0 about him;
Said Farah, Naresh Bhatt, Tommy Robinson and Faith Hedgepeth appear in none of the host's 2,355 transcripts. Where footage did exist
(50 Cent, Lou Sims) the campaign searched the catalog again and missed the very passage the topic came from. The new-videos lane reused
the same Diddy videos daily and lost two of them to the "upcoming" filter. Two hit videos sat in "transcribing" for 5–6 days. Downloads
fell to 360p from Oct 30 (cookies from Oct 17, bot check failing). Nothing retried partial days and nothing reported any of it.

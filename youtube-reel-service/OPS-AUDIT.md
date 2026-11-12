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

## Nov 6, 2026: the 2-a-day test

The client paused the 5-a-day pace: the long videos slowed after Oct 22 (5 reels a day) and he wants to see whether the reels are the
cause. From Nov 6: the daily run makes `REEL_DAILY_REELS` = 2 reels (all on the main topic; the lanes only fill a short day), and
auto-publish posts 2 a day at 11:00 AM and 9:00 PM New York (the two best slots by first-24h views, Oct 16 - Nov 5). Change the count
with the `REEL_DAILY_REELS` env and the slots in the channel's auto-publish settings, not in code.

How to read the result: each report has a `main channel:` line with every long video of the last 14 days, its age in days and its
views so far. Compare a video's views at d3 and d7 (from the reports of those days) with the long videos of Oct 22 - Nov 5. Comment
replies changed the same day (the 3 newest long videos are now checked every 45 min; reels had taken 8 of the 10 reply slots), which
can also lift the long videos.

## Nov 13, 2026: views audit and the changes it led to

Findings (76 posted reels + YouTube Analytics): the reels did not slow the long videos (long views/day 6,092 with no reels, 6,301 at 5
reels/day); downloads were dead Nov 5-12 (cookies rejected 38 min after import) and three days made 0 reels while a campaign waited on
one blocked video; the first spoken line decides the reel (first person: median 2,263 views, general statement: 1,294); court-procedure
reels median 396, prison-life details 1,896; the critic score has no relation to views (Spearman -0.07); a re-posted story earned 260
views after 13,148. Best upload hours (NY): 10-11 AM and 7 AM, then 9 PM; 8 AM is the worst.

What changed:
- yt-dlp 2026.10.26 + bgutil PO tokens (`reel-pot` sidecar, /etc/yt-dlp.conf).
- A preparing campaign goes ahead after 3 h with 2+ ready videos (6 h with 1): `givesUpWaiting` in queue/orchestrator.service.ts.
- Developer push alerts (pipeline/alerts.ts, AlertService, every 10 min, once per problem per 12 h): downloads stopped, 0 reels by 4 PM,
  short day by 8 PM, stuck campaigns, auto-publish paused, failed posts, low stock. Set `ALERT_WEBHOOK_URL` (an ntfy.sh topic URL pushes to
  a phone) in youtube-reel-service/.env.prod. `ops:alerts [--check]` shows what it sees.
- Ranking (publishing/appeal-model.ts): lifts for the opening line and the topic, refit daily from real 48-hour views; the critic score is
  only a gate and a tie-breaker; court words no longer count as concrete; posts about the same person in 7 days push a reel down.
  Candidates are taken newest first, not by critic score. The model in use: reel_settings `appeal-model:<channelId>`.
- Repeats are held: the same story (embedding cosine >= 0.68) within 30 days, or a video that already gave 2 posts in 14 days; used only
  when the day cannot be filled otherwise.
- Director/critic/topic prompts: the first line must be the host's own experience or a famous name in a concrete moment; no court-procedure
  reels; topic angle multiplier (prison life x1.15, court procedure x0.6) in daily-brain.
- "news" lane: every long video analyzed within 36 h of going up gets one reel the same day (LanesService.newsReels).
- 3 reels a day (`REEL_DAILY_REELS`=3), posted at 7:00, 11:00 and 21:00 NY.
- The full-screen look's bottom line says "FULL STORY ON MY CHANNEL" (comment links are not clickable on Shorts).
- Not automatable: YouTube Studio "Related video" on each reel (the only clickable route from a Short to a long video; the API cannot set it).

# Reel service: change log and audit trail

Newest first. Each entry says what changed, why (with the number that showed it), where in the code, how to check it on the
server, and how to undo it. Times are New York unless noted. Server: `ssh root@2.24.105.72`, repo `/var/www/youtubeai`, reel stack
`docker compose -f docker-compose.reels.yml up -d --build` (project `youtubeai-reels`).

---

## 2026-10-31: AI images removed from reels

**Client decision:** drop the AI pictures from reels. The video look and structure stay as they were (host video in the template
window, captions, pace, ending sound).

**Removed**
- `pipeline/visuals.service.ts` (plan + generate + replace/remove), `prompts/beats.prompt.ts` and its spec, `pipeline/card.ts`
  (the picture card).
- In `pipeline/filtergraph.ts`: `RenderImageInput`, `imageInputArgs` and the picture overlay in `renderGraph`.
- In `pipeline/renderer.service.ts`: the image step before the render, the picture times in word realignment, the picture inputs
  (the ending-sound input index is now `clips.length + 1`).
- API: `POST reels/:id/visuals/:vid/replace|remove`, the `visuals` field of a reel, the `beat-*` media route, the `images`
  breakdown (`analytics.service.ts`, `learning.service.ts`, `api/dto.ts`).
- Settings `REEL_IMAGES_ENABLED`, `REEL_IMAGES_MAX`. Schema fields `reel.visuals`, `reel.visualsVersion`.
- Frontend: `components/reels/reel-images.tsx`, `changeVisual`, `ReelVisual`, the "Pictures" breakdown option.
- Publishing: `containsSyntheticMedia` now defaults to `false` (it was true when a reel had a ready picture of a real person).

**Kept on purpose**
- `ai/image-gen.service.ts`, `REEL_IMAGE_MODEL`, `REEL_IMAGE_QUALITY`: the **thumbnails** still draw an AI scene (with a real
  person's reference photo when we hold one). The client has not decided about thumbnails, so they are unchanged.
- `pipeline/people.service.ts` (new): `peopleWithPhotos` / `readPhoto` / `nameTokens` / `sameName`, moved out of the deleted
  visuals service because the thumbnails need them.
- Old reels keep `visuals[]` and their `beats/*.jpg` in MinIO. Nothing reads them. Safe to delete later to save space.

**Effect on already-rendered reels:** reels rendered before this deploy still have pictures baked into their `reel.mp4`. Only a
re-render ("Refresh look" in the app, or `rerender`) makes them picture-free. Reels already posted are not touched.

**Check:** a new render log no longer has `beats:` / `beat:` lines; `reel.visuals` stays empty on new reels; the reel detail
window has no "AI images" panel; the breakdown picker has no "Pictures" option and `by=images` is rejected by the API.

**Undo:** `git revert` the commit "remove AI images from reels", rebuild. Old data is intact.

---

## 2026-10-30/31: views audit and fixes (own videos first)

**Why.** Views per reel fell from about 1,300 (Oct 22) to about 250 (Oct 29) in every lane. Findings from the production DB:
the small video window on black; the same few source videos and the same look recycled; abstract "Topic: lesson" titles; the
paired slots (8/9 AM, 9/10 PM) get about half the views of a single slot; no retention signal in ranking; 90% of reel views come
from the Shorts feed (so the first seconds and the look decide everything); average watched about 47%.

### Commit `79263a2`: own-videos-first fixes
- **Stale "upcoming" flag no longer hides aired videos** (`pipeline/lanes.ts` `isSourceable`). A 108-minute, 15.8k-view video was
  skipped for 11 days because YouTube still said `liveBroadcastContent: 'upcoming'`. Now `upcoming` only excludes a video with
  fewer than 100 views or a future publish date; `live` is still excluded.
- **Zero-moment videos are re-mined once** (`lanes.service.ts`, `MAX_REMINES_PER_CHECK = 2`; `reel_sources.remined`). At most 4 new
  uploads are started per 45-minute check (`MAX_KICKS_PER_CHECK = 4`).
- **Explore lane off** (`REEL_EXPLORE_ENABLED=false`, `config.ts`; `daily.service.ts` gives the slot to main). The mix constant
  `DAILY_MIX = fresh 3, main 1, explore 1` is unchanged, so turning explore back on needs no code.
- **Ranking** (`publishing/auto-plan.ts` `appeal`):
  `0.35*score + 20 if a named person + 80*min(0.3, demand) + 3*ln(1+sourceVelocity) + 15*concreteness - 8*min(2, recentUsesOfSource)`.
  `concreteness(text)` (0..1): digit +0.25, first person +0.35, event words +0.4, abstract words -0.4.
- **One reel per source video per day** (`chooseReels`, `maxPerSource`; relaxes in steps only if the day cannot be filled).
- **Titles `packaging-v3`** (`prompts/packaging.prompt.ts`): "Person or case: specific thing", bans "discussion" and abstract lessons.
- **"% watched"** is computed from watch minutes when no retention figure exists (`youtube.publisher.ts` `watchedPct`). Daily stats
  lag about 3 days and have no retention column. It is recorded but **not yet used in ranking**.

### Commit `33962cb`: Whisper looping on the video title
`pipeline/transcript.ts` `transcriptLooping`: true when one normalised line is 6 or more repeats and 15% or more of the lines,
or fewer than 3 lines per minute on audio of 5 minutes or more. `analyzer.service.ts` re-transcribes with other prompts
(`Unique Mecca Audio. <title>.`, `Unique Mecca Audio.`, none) and fails the job if all loop. Cause: the Wack 100 video produced
53 copies of its own title, so 0 moments could be mined. After the fix: 322 lines, 7 moments.
Known leftover: video `hutytsxXDIw` ("Jamaican Gangs") is about 20% repeated; left alone.

### Commit `ad659b4`: random posting time inside +-30 minutes
`auto-plan.ts` `jitterRunAt`: each post goes out at a random second within 30 minutes either side of its slot (8:00 means
7:30 to 8:30), never earlier than now + `MIN_LEAD_MIN` (20), never within `MIN_GAP_MIN` (12) of another post that day. Seeded by
`channel:date:slot`, so a day's plan can be replayed. A slot stays usable until `slotTime + 30 min` has passed. The upload job is
queued to start 2 minutes before `runAt`. Slots themselves are the client's list and are unchanged: 08:00, 09:00, 20:00, 21:00, 22:00.
`auto-publish.service.ts` `plan()` assigns the times and saves them on the day record (`reel_autopublish_days`).

### Earlier in the same push (already live)
`6688fef` hit-video-first lane, appeal ranking, named-person rule, no channel-name titles; `d3328b8` descriptions in first person;
`3cbd4e5`, `c440cad` a views slump slows auto-publish to 3 a day for 3 days (`SLOW_POSTS`, `SLOW_DAYS`) instead of stopping it, and
the baseline compares 24-hour views on both sides. Slow mode (08:00, 20:00, 22:00 only) was active until 2026-11-01 15:50 UTC.

### Format test (not a pipeline change)
Three full-screen sample reels were imported as normal reels (campaign "Full-screen format test (3 reels)", reel
`templateName: fullscreen-v1-test`) and scheduled as the whole 2026-10-31 plan: 8 AM, 8 PM, 10 PM (random within +-30 min). Scripts
and layout notes: `scripts/samples/`. **How to judge:** 24-hour views against the recent norm of 250 to 900, and "% watched" about 3
days later. Three posts are a direction, not proof. Cancel a post in the app before its upload time to stop it.

---

## Open items

| Item | Waiting on | Notes |
|---|---|---|
| Full-screen layout in the live pipeline | Client feedback on the 3 samples | Needs a per-cut layout detector first: the studio switches sides inside one video (host left / picture right, then reversed). Plan: grab a still frame per cut, detect the host and picture boxes, crop per cut, safe centre-crop fallback; about 2 to 3 days, test on about 20 videos. Prototype in `scripts/samples/`. |
| Thumbnails with an AI scene | Client | Unchanged. Without the AI scene a thumbnail would be a reel frame under a second headline. Custom covers also do not show on the channel's Shorts tab. |
| Newer template (smaller phone number) | Client / user | In the repo only. The live template is the old one (window y=560, h=760) in MinIO bucket `reel-templates`. Uploading needs the CLI; conflicts with the full-screen decision, so ask first. |
| Use "% watched" in ranking | Data (about 3 days lag) | Value is recorded as `avgViewPct`. |
| Paired slots (8/9 AM, 9/10 PM) | Client | His own list, left unchanged. Pairs get about half the views of a single slot. |

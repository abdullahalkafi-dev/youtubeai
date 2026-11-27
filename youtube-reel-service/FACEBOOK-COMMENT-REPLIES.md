# Facebook comment replies: how it works and how to audit it

Written 2026-11-26. Audience: the next developer or auditor. Everything here describes the code as shipped; where something could not be
checked against the live Facebook API it says so ("unverified").

## 1. What it does

The Page "Mecca Audio Entertainment" posts reels every day (see `facebook-lane.ts`). People comment on them. This lane answers those
comments **as the Page**, in the host's voice, automatically, under hard rules about what it may never answer, how fast it may post and
how many replies a day. Every comment it looks at gets one row in MongoDB, so any reply (or non-reply) can be traced later.

It lives in the reel service next to the Facebook publisher, **not** in the YouTube comment auto-reply of the main backend
(`youtube-ai-backend/src/comments`). The two share the idea and the voice, nothing else: different token, different API, different tone.

## 2. Modes (the switch)

`FACEBOOK_REPLY_AUTO` in `youtube-reel-service/.env.prod` on the server:

| value | what happens |
|---|---|
| `off` (default) | nothing runs, nothing is read, nothing is written |
| `dry` | comments are read, the model writes replies, the rules check them, rows are stored as `dry_run`. **Nothing is sent to Facebook.** Use it to read the replies before they go live |
| `on` | as `dry`, and queued replies are posted (one every 2 to 6 minutes) |

Switching: edit `.env.prod`, then `docker compose -f docker-compose.reels.yml up -d --force-recreate reel-api reel-worker` (from `/var/www/youtubeai`).
Going from `dry` to `on` is safe: a `dry_run` row does not count as handled in `on` mode, so those comments are answered for real
(with a freshly written reply).

Other settings (all optional): `FACEBOOK_REPLY_DAILY_CAP` (35, replies per New York day; a dry run counts its would-be replies against the same
number), `FACEBOOK_REPLY_REEL_DAYS` (7, only reels published in the last N days and comments not older than that are answered).

## 3. The flow (every 10 minutes)

Maintenance task `facebook-reply` (`worker-processors.ts`, handled in `maintenance.service.ts`) calls `FacebookReplyService.runDue()`.
For each channel with Facebook posts, `tick()`:

1. **Stop checks.** Mode `off`, lane paused (section 6), or Facebook not connected: return.
2. **Post** (`on` only, `postNext`; also run alone every minute by task `facebook-reply-post`, so the gap is real): at most **one** queued reply per pass, and only when
   - at least a random **2 to 6 minutes** have passed since the previous posted reply (`gapMs`, fixed by the previous reply's time, so a retry cannot shorten it);
   - fewer than the daily cap were posted today.
   Replies queued for more than 24 hours are dropped (`stale`). Right before posting, the comment is read again from Facebook: if it was deleted
   (`comment_gone`) or already has any reply (`has_replies`) nothing is sent. Then `POST /{comment-id}/comments` with the Page token, which
   replies as the Page.
3. **Discover** (`discover`): reads the comments of the 3 published reels whose comments were read longest ago
   (`reel_posts.commentsCheckedAt`, oldest first), `filter=toplevel`, newest first, 50 per reel. For each comment not yet in `reel_comment_replies`:
   1. older than the window: ignored (no row);
   2. the Page's own comment (author = the Page, or text starting "Watch the full video on YouTube", which is our own link comment): `skipped / own_comment`;
   3. it already has replies: `skipped / has_replies` (a person is already in that thread);
   4. the hard rules (section 4) say no: `skipped / <reason>`; **the model never sees these**;
   5. the rest, newest first, up to 8 per pass, go to the model in one call.
   The model returns reply-or-skip for each. A skip is stored with its reason. A reply is cleaned, checked by the rules again (section 4), and stored
   as `queued` (`on`) or `dry_run` (`dry`). Comments the model dropped, or that do not fit under the cap/queue limit (6 waiting), are simply not stored and
   are decided again on a later pass. If the model call fails (no credits, outage) nothing is stored and the same comments are retried.

## 4. The rules (what it never does)

All in `facebook-reply-rules.ts` (pure functions, unit tests in `facebook-reply-rules.spec.ts`), the model instructions in `facebook-reply.prompt.ts`.

**Never answered, decided in code before the model (`hardSkipReason`):**
`no_text` (photo/sticker only) · `too_long` (over 600 characters) · `needs_care` (self-harm words) · `threat` · `slur` (any slur, whatever the intent) ·
`abuse` (insults and aimed profanity) · `spam` (links, domains, WhatsApp/Telegram/CashApp/crypto/"dm me", phone numbers) · `politics`.
Skipping is the safe side: a false skip costs one unanswered comment.

**The model may also skip** (`skipReason`): `abuse, spam, politics, off_topic, needs_care` (someone's own legal case, advice requests), `argument`
(commenters fighting each other, and criticism or debate aimed at the Page, the host, the guest or the topic: the Page never argues or defends itself in comments), `language` (not English), `risky`, `other`. The prompt says "when unsure, skip".

**What a written reply must satisfy (`cleanReply` then `validateReply`), else the comment is stored `skipped / reply_<why>`:**
no links (a reply that contained one is rejected, not repaired), no long dashes, no hashtags or @mentions, at most one emoji, at most 180 characters and at least 6,
none of the forbidden phrases ("as an AI", "I hear you, but", the private names "Wainsworth"/"Hall", lawyer-speak), no phone number except the booking line
1-917-680-9091, and **not a repeat** of one of the last 40 replies (same text, or the same first 16 letters). Variety is a rule: a Page answering alike looks like a bot.

**The voice** (prompt): the host (62, 26 years federal prison, Harlem) on the porch: short (one sentence, two at most, usually 4 to 16 words), plain, warm, a little street, no
debate, no accusations, no legal advice, "Salute" at most once in ten, never mentions AI. Facebook commenters' names are not returned by the API, so replies never address anyone by name.

## 5. Where everything is stored

Collection **`reel_comment_replies`** (schema `db/schemas/reel-comment-reply.schema.ts`), one row per comment, unique on `(platform, commentId)` so nothing is answered twice:

| field | meaning |
|---|---|
| `decision` | `queued` (written, waiting its turn) · `replied` (posted) · `dry_run` (would have posted) · `skipped` (final) · `failed` (3 failed attempts) |
| `skipReason` | why it was skipped (section 4), also `stale`, `comment_gone`, `has_replies`, `own_comment`, `reply_<why>` |
| `commentText` / `commentCreatedAt` | the comment (cut to 500 characters) |
| `replyText` / `replyId` / `tone` | what was written, Facebook's id of the posted reply, the model's tone label |
| `mode` | `dry` or `on` when it was decided |
| `queuedAt` / `repliedAt` / `attempts` / `error` / `errorCode` | timing and failures |
| `postId`, `reelId`, `externalPostId`, `channelId` | which reel and which Facebook video |

Also: `reel_posts.commentsCheckedAt` (round-robin of reels) and `reel_settings` key `facebook-reply:<channelId>` (`pausedReason`, `pausedAt`, `pausedUntil`, `consecutiveFailures`).
No tokens are stored or logged here; the Page token is read from `meta_connections` by `MetaTokenProvider` as for posting.

## 6. When it stops by itself (and how to restart it)

- Facebook refuses the login or the permission (auth error): paused **until reconnected**. Reconnect in the app Settings, then `fbreply:resume`.
- Facebook limits commenting (rate error, code 368, "temporarily blocked", "slow down"): paused for **12 hours**, clears itself.
- 3 failed reply attempts in a row (any comments): paused for **3 hours**.
- A single comment that fails 3 times becomes `failed` and is not retried.
The pause reason is written to the worker log (WARN, "Facebook comment replies paused") and shown by `fbreply:log`. It is never shown to the client in the app.
Hard kill switch: `FACEBOOK_REPLY_AUTO=off` (section 2).

## 7. How to audit it

Inside the worker container (`docker exec youtubeai-reels-reel-worker-1 ...`):

```
node dist/cli/reel-cli.js fbreply:log <channelId> [n]      # mode, pause, today's and all-time counts, newest n decisions: comment -> reply
node dist/cli/reel-cli.js fbreply:run <channelId>           # one pass now (posts one queued reply if mode is on)
node dist/cli/reel-cli.js fbreply:resume <channelId>        # clear a pause
```
HTTP (signed-in app user): `GET /api/reels/channels/<channelId>/facebook/replies` returns the same overview as JSON.
Channel id of the client's channel: `6a81e0e956c00363be7b404e`.

Questions an audit asks, as mongosh against `youtube_ai`:

```js
db.reel_comment_replies.aggregate([{ $group: { _id: { d: '$decision', r: '$skipReason' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }])   // what happens to comments
db.reel_comment_replies.find({ decision: 'replied' }).sort({ repliedAt: -1 }).limit(20)                                           // the last 20 live replies, with the comment
db.reel_comment_replies.countDocuments({ decision: 'replied', repliedAt: { $gte: ISODate('2026-11-27T05:00:00Z') } })             // replies since a time
db.reel_comment_replies.find({ decision: 'skipped', skipReason: /^reply_/ })                                                     // replies the rules rejected after the model wrote them
```
Judge the dry run by reading `fbreply:log`: are the skips right (abuse, spam) and do the replies sound like him and answer the comment? Tune the prompt
(`facebook-reply.prompt.ts`) or the rule lists, record the change in `CHANGELOG.md`, redeploy.

## 8. Code map

| file | role |
|---|---|
| `src/publishing/facebook-reply.service.ts` | the lane: `runDue`, `tick`, `postNext`, `discover`, `overview`, pause/resume |
| `src/publishing/facebook-reply-rules.ts` | pure rules: `hardSkipReason`, `isOwnComment`, `cleanReply`, `validateReply`, `gapMs`, `replyPause` |
| `src/publishing/facebook-reply.prompt.ts` | the model instructions and the output schema |
| `src/db/schemas/reel-comment-reply.schema.ts` | the stored rows |
| `src/config/config.ts` | `FACEBOOK_REPLY_AUTO`, `_DAILY_CAP`, `_REEL_DAYS` |
| `src/pipeline/maintenance.service.ts`, `src/worker/worker-processors.ts`, `src/queue/queue.service.ts` | the 10-minute task `facebook-reply` |
| `src/api/publishing.controller.ts`, `src/cli/reel-cli.ts` | `GET facebook/replies`, `fbreply:*` commands |
| `src/publishing/facebook-reply-rules.spec.ts`, `facebook-reply.service.spec.ts` | tests (rules; the whole flow against a fake database, Facebook and model) |

## 9. Known limits and what is unverified

- **Replying has not been tried live** when this was written (it needs a real public reply). Reading comments was verified (HTTP 200, 54 comments on the Honey Buns reel).
  The app already requests `pages_read_user_content` and `pages_manage_engagement`; whether the client's login granted `pages_manage_engagement` for replies is
  confirmed only by the first live reply. A permission error pauses the lane with "reconnect Facebook" and stores nothing as replied.
- Facebook does not return most commenters' names (`from` is missing), so own-comment detection also uses the link comment's text, and replies cannot use names.
- Only top-level comments are answered, and a comment that already has any reply is left alone (we cannot tell a person's reply from ours when `from` is hidden).
- The rule word lists are English and conservative; a false skip is cheap, a false reply is not. Extend them when the dry run or the live log shows a miss.
- Instagram comments are not covered (a separate permission, `instagram_manage_comments`, is still to be added; see the memory note "Instagram comment permission TODO").
- Hiding abusive comments (instead of only not answering them) is not built.

## 10. Dry run of 2026-11-26 (what was seen, what was changed)

8 passes in `dry` mode over the 25 Facebook reels gave 15 written replies and 67 skips (own link comments, comments that already had replies, no text, abuse, slurs, threats, too long,
not about the reel). Replies read as intended ("Glad it resonated with you.", "Thanks for showing love.", "It really is..."), short, no links, no dashes. One reply argued back to a
criticism ("Sharing what prison was like isn't the same as calling it heroic"): the prompt was tightened so criticism and debate are skipped (the stored dry-run row of that comment
still shows the old reply; it is rewritten when the mode goes `on`). Some skips are over-cautious (a joke containing "kill you" matched the threat rule): accepted on purpose.

## 11. Undo

Set `FACEBOOK_REPLY_AUTO=off` and recreate the containers: the lane stops at once. Posted replies stay on Facebook (delete them there if needed; their ids are
in `replyId`). To remove the code: revert the commit that added this file; the collection can be dropped (`db.reel_comment_replies.drop()`), nothing else reads it.

## 13. Diagram

```
 every 10 min (facebook-reply)                         every 1 min (facebook-reply-post)
 ---------------------------------                     ---------------------------------
 pick 3 reels, read newest comments                    mode on? lane not paused?
        |                                              last reply older than a random 2-6 min?
        v                                              fewer than the daily cap today?
 already in reel_comment_replies? --yes--> ignore             |  yes
        | no                                                  v
        v                                              take the oldest "queued" reply
 Page's own comment / empty / link / abuse /                  |  (older than 24 h: dropped as stale)
 slur / threat / politics / self-harm?  --yes--> skipped      v
        | no  (hard rules, no model)                   read the comment again on Facebook
        v                                              deleted? -> skipped (comment_gone)
 model (8 at a time): reply or skip                    already has a reply? -> skipped (has_replies)
        |                                                     |  fine
        v                                                     v
 reply passes validateReply?                           POST /{comment}/comments as the Page
 (short, no link/dash/number, not a repeat)                   |
        | no -> skipped                                       +-- ok -> replied (stored with replyId)
        | yes                                                 +-- login/permission error -> lane paused until reconnect
        v                                                     +-- rate/spam block -> paused 12 h
 mode dry: store as dry_run (never posted)                    +-- other -> retry, 3 fails -> failed
 mode on:  store as queued  -------------------------------->  (3 fails in a row on different comments -> paused 3 h)
```

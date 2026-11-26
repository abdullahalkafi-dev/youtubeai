# youtube-podcast-service

Turns every new long YouTube video of the channel into a public Buzzsprout podcast episode: cached video (or audio-only download) → long silences
shortened → podcast MP3 → episode text, tags and chapters from the YouTube video (timestamps remapped to the trimmed audio) → upload → publish.

Isolated like the reel service: own image, own compose project (`docker-compose.podcast.yml`, project `youtubeai-podcast`), port 5004, nginx `/api/podcast/`.
It only READS the main app's `videos`/`users`/`channels`, the reel service's `reel_sources`/`reel_settings` (cookies) and bucket `reel-sources`.
It writes only `podcast_episodes`, `podcast_settings` and bucket `podcast-audio`.

Design, API facts, switches and operating notes: `docs/podcast-service/README.md` (local, private docs folder).

Switches (`.env.prod`): `PODCAST_ENABLED`, `PODCAST_AUTO` (`on` = find new videos by itself), `PODCAST_AUTO_SINCE`, `PODCAST_DRY_RUN`,
`PODCAST_MIN_DURATION_SEC`, `BUZZSPROUT_API_KEY`, `BUZZSPROUT_PODCAST_ID`.

Tests: `pnpm test` (silence planning, chapter remapping, metadata, Buzzsprout client). Typecheck: `pnpm typecheck`.

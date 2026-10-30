# Full-screen reel look (sample prototype, 2026-10-31)

Proposed new reel layout, rendered only as samples for the client (nothing is posted, the live renderer is untouched).

- `gen-sample-specs.mongosh.js`: run with mongosh; prints JSON with the moment window, word timings (from `reel_transcripts`) and per-video crop boxes.
- `render-fullscreen-sample.js`: run inside the reel worker container (`node render-fullscreen-sample.js spec.json [id]`); needs the source videos in `/work/samples/src/<youtubeId>.mp4` and writes `/work/samples/out`.

Layout (1080x1920): headline (Anton 140, second line yellow) at the top, the story picture cropped from the host's studio frame, the host cropped big at the bottom
with a blurred fill at the sides, captions over the host's hat, a gold line between the blocks, "FULL VIDEO - CHECK DESCRIPTION" and a small phone line at the bottom.

Known limit: the studio scene changes inside a video (host left / picture right, or the reverse), so the crop boxes are set per moment here. A production version
needs a per-cut layout detector (face position and the gold picture frame) before it can be automatic.

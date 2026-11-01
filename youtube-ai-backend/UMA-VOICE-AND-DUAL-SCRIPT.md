# Unique's voice, book memory and the two-script message

What changed for script requests in the live chat (the legacy chat path; the Content Studio is unused in
production and was not touched). Single channel: every switch below is one global environment variable in
`youtube-ai-backend/.env.prod`; none are per-channel. Restart the backend container after changing one.

| Variable | Default | Effect |
|---|---|---|
| `UMA_PERSONA` | on | Appends Unique's persona (reformed outlaw, his quotes, legal caution once, the twist slot) to the General, Script and Outline prompts, and adds the per-request twist brief. |
| `UMA_BOOK_RECALL` | on | Script/outline requests recall the moments of his life that mirror the story (full book, matched by situation). Off = the old three short summaries. |
| `UMA_DUAL_SCRIPT` | on | A fresh script request also writes the bullet script as a second block in the same message. |
| `UMA_EXPLICIT_LANGUAGE` | **off** | Lets scripts use the raw street word. Off = profanity yes, racial slurs no. The client's call. |

## Pieces
- `src/chat/script-guards.ts` — a pasted script can no longer turn a script request into a video autopsy.
- `src/openai/prompts/unique-persona.ts` — persona text, twist shapes, bullet-script instruction.
- `src/chroma/book-chunker.ts`, `book-source.ts`, `auto-seed.service.ts` — the book (`src/assets/seed/a_roar_in_harlem.txt`)
  is cut into ~420 chapter/scene chunks and ingested into Chroma `client_book_full` on boot. Idempotent: a matching
  chunk count means nothing is rewritten; a different count clears that source and re-ingests. `client_book`
  (the 23 hand-written summaries) is untouched and remains the fallback.
- `src/chat/book-memory.service.ts` — turns the request into the human situation (small fast-model call, ~5-8 s, 20 s
  timeout), searches the book with several scene queries, picks 5 chunks (max 2 per chapter, avoiding the ones used
  by the last scripts of the thread) and formats the "FROM UNIQUE'S OWN LIFE" block. Never throws.
- `src/chat/twist.ts` — reads earlier point-2 twists from the thread so the next one does not repeat them.
- `src/chat/dual-script.ts` — decides when to write the bullet script, validates and inserts it. It is wrapped in
  `<!-- BULLET_SCRIPT_START/END -->` so the full-script cleaners (which strip `A. HEADING` lines and split long
  rails) never see it. Inserted right after the full script's `SCRIPT_END`.
- Frontend: `content-detector.ts` turns the bullet block into a second script card; `ScriptRenderer` takes
  `variant="bullet"`; saving it stores `metadata.bulletScriptId` (the full script keeps `metadata.scriptId`); the
  stream's `done` event carries `finalContent` so the live view matches the saved order.

## 2026-11-01 audit fixes (from the client's real chats of Oct 28-31)
- **Router on long dictated asks** (`intent-classifier.service.ts`): the fast model's reasoning used up the old
  250-token budget on his 1,000-3,300 character dictations (replayed live: 4 of 12 runs fell to the keyword
  fallback, 9 of 12 needed a retry). Budget is now `ROUTER_MAX_TOKENS` 2000, timeout 12 s, long messages go in as
  head + tail (`routerText`). If the model still fails, `guardLongStoryFallback` turns a long "write this up /
  rewrite this / write me a story" ask that the keywords read as `image`/`outline`/`general` into a script ask with
  `freshScript: true` (both cards). A deliberate package / SEO / thumbnail ask is left alone. The fallback logs
  `[Intent] Routed by the keyword fallback`.
- **Book memory fit test** (`book-memory.service.ts`): now strict. The same turning point must be in the story and
  in the passage; a broad theme (loyalty, family, a visit, a job) is not enough, and "unsure" means `{"pick":0}`
  (point 2 is then built from his mind alone). Look for `Book recall: no passage fits this story` in the logs to see
  how often it now declines.
- **Voice** (`unique-persona.ts`, `uma-persona-v6`): "NEVER THE REPORTER" block: no more than two plain fact lines in a
  row, name who/what the video is about within the first eight lines, cut the case-file detail, "Imagine/Picture" may
  open at most one section. The bullet card allows two of those words instead of five.
- **Dictate bullets button** (frontend `chat/page.tsx`): it sat at the end of a horizontally scrolling tool row, so on
  a normal window it was out of sight. It now sits next to Send, and a one-line tip under the box (hidden after the
  first use or close, remembered in `localStorage` key `uma.dictateHintSeen`) explains it.

## Rollback
Set the relevant variable(s) to `false` and restart the backend. No data migration is involved; the new
Chroma collection and the `bookChunkIds` / `dualScript` message fields are simply ignored.

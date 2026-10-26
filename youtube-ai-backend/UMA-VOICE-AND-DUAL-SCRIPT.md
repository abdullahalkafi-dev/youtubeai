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
- `src/chat/book-memory.service.ts` — turns the request into the human situation (small fast-model call, ~5 s, 12 s
  timeout), searches the book with several scene queries, picks 5 chunks (max 2 per chapter, avoiding the ones used
  by the last scripts of the thread) and formats the "FROM UNIQUE'S OWN LIFE" block. Never throws.
- `src/chat/twist.ts` — reads earlier point-2 twists from the thread so the next one does not repeat them.
- `src/chat/dual-script.ts` — decides when to write the bullet script, validates and inserts it. It is wrapped in
  `<!-- BULLET_SCRIPT_START/END -->` so the full-script cleaners (which strip `A. HEADING` lines and split long
  rails) never see it. Inserted right after the full script's `SCRIPT_END`.
- Frontend: `content-detector.ts` turns the bullet block into a second script card; `ScriptRenderer` takes
  `variant="bullet"`; saving it stores `metadata.bulletScriptId` (the full script keeps `metadata.scriptId`); the
  stream's `done` event carries `finalContent` so the live view matches the saved order.

## Rollback
Set the relevant variable(s) to `false` and restart the backend. No data migration is involved; the new
Chroma collection and the `bookChunkIds` / `dualScript` message fields are simply ignored.

/**
 * Shared teleprompter spoken-cadence contract for all script surfaces:
 * chat system prompt, Script Writer skill, and AI Beautify Rhythm.
 *
 * Gray blockquote rails and breath blocks stay. Only line length inside
 * a breath block changes. Parallel list style is optional per section.
 */

export const SPOKEN_LINE_CONTRACT = `SPOKEN LINE CONTRACT (CRITICAL — BREATHABLE TELEPROMPTER):
- KEEP the gray blockquote rail: EVERY spoken line still starts with "> ".
- KEEP breath blocks: 2 to 6 consecutive "> " lines share ONE gray rail group. Do NOT put an empty "> " after every sentence. Do NOT make every single sentence its own isolated gray line with a cue after it.
- Cues ([BEAT] / [PAUSE]) go BETWEEN breath blocks on their own line — not after every sentence.
- Inside a breath block, each "> " line must be speakable in one natural breath:
  * Target 5–10 words per line.
  * Hard ceiling about 12 words for normal speech lines.
  * Punch lines may be 2–5 words.
  * One complete spoken thought per line (subject + verb). Not random fragments.
  * If a rail holds two independent ideas, split into two "> " lines INSIDE the same breath block (no cue between them unless that thought truly ends).
  * Split stacked clauses, long "because / built by / in order to" tails, and multi-item walls into shorter rails in the same block.
- Delivery style is DYNAMIC per section: scene, contrast, story, Q&A, lesson, courtroom translation. Use parallel openings ONLY when the section's ideas are truly parallel — never force a fixed "If he... If he..." pattern on every list.
- Legal / educational lines: keep accuracy. Deliver fact → what it does NOT mean → lesson as short rails, not one disclaimer wall.
- CTAs: 1–3 short rails BEFORE ### **JEWEL**, then the comment phrase. Never one long "If you..., comment X" wall.
- Jewels: Principle / Consequence / Direct Question as separate short rails, then [PAUSE].
- Natural contractions fit Unique's voice: "don't", "he's", "ain't".
- DENSITY lives in the BLOCK (enough short rails to teach), not in stuffing words into one rail.
- Scripts are SPOKEN to the class / youth — not read like an article.`;

export const GOLD_SPOKEN_EXAMPLES = `WRONG vs RIGHT (copy the RIGHT style — short rails INSIDE breath blocks; keep gray line groups):

WRONG (forbidden — essay wall on one rail, sounds like reading):
> But a victory in court does not automatically erase the psychological cell built by years of pressure, loss, public judgment, and survival mode.
> If you've ever watched a person get dragged into trouble because of who they stood beside, comment, "WHO YOU STAND WITH MATTERS."

WRONG (forbidden — over-split; do NOT isolate every sentence on its own gray line with a cue after each):
> The case can end.

> The psychological cell can stay.

   [PAUSE]

RIGHT (required — one breath block = one gray rail group; lines short and speakable):

> Not guilty ends that case.
> It does not always end the mind.
> The body can leave.
> The fear can stay.

[BEAT]

> The cameras see the verdict.
> The fans see the celebration.
> The internet sees the headline.
> But the family sees the phone calls.
> They see the bills.
> They see names that still don't sleep right.

[PAUSE]

> This is not a new RICO charge against Lil Durk.
> This is how federal memory works.
> A case can end.
> A pattern can still matter.
> Indictment is not conviction.
> Theory still has to be proven.

> If that hits you, comment WHO YOU STAND WITH MATTERS.

### **JEWEL**

> Loyalty can look like love from the street.
> The paperwork can call it a pattern.
> Who are you when the paperwork gets quiet?

[PAUSE]`;

export const BEAUTIFY_SPOKEN_RULES = `SPOKEN VOICE & LINE LENGTH (CRITICAL):
- Write like an OG on the couch teaching the class — NOT a news recap or true-crime documentary narrator.
- KEEP the gray blockquote rail ("> " on every spoken line).
- KEEP breath blocks: 2–6 consecutive "> " lines as one rail group. NEVER empty "> " after every sentence. NEVER isolate every sentence with its own cue.
- Inside each breath block, every line must be breathable: target 5–10 words, max about 12 words. One complete thought per line.
- Split long essay rails into shorter "> " lines in the SAME block. Do not turn short lines into one-word poetry.
- Parallel structure only when the section needs it — style stays dynamic.
- CTAs and jewels in short rails; no long "If you..., comment X" walls.
- Each major section needs at least one short punch line (2–5 words when it lands).
- Keep all original facts, names, and legal points. Rewrite delivery, not truth.`;

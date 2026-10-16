# Content studio rollout and verification

The studio uses MongoDB for durable state, Bull/Redis for execution, MinIO for assets, existing AI/search/reference services, and Sharp for exact headline composition. The reel service is independent.

## Enable and roll back

New studio runs are disabled by default. Deploy backend and frontend together before enabling a channel. In Chat, open **Creative preferences** and enable **Agent workflow for new requests**. The authenticated channel-owner PATCH endpoint supports the same setting.

Alternatively, set CONTENT_STUDIO_CHANNELS to comma-separated channel IDs. This supplies the initial default for channels without saved preferences. A saved preference overrides the environment default, so the owner can disable it in the UI.

Rollback: disable the preference for affected channels. Existing executionVersion 1 runs continue or can be explicitly cancelled. Keep workers and collections available until outstanding runs settle. Do not delete queues, collections, images, or message history.

The browser never automatically generates images from historical message mounts. Legacy manual generation remains available. New messages render structured artifacts and independent image state. Publishing is outside the studio workflow.

## Storage and execution

New collections:
- creator_preferences: unique channelId; revision-protected explicit preferences, examples, reference notes, duration, pace and branding.
- episode_briefs: unique threadId/sourceRequestId; subjects, promise, emphasis, evidence, attachments and preference snapshot.
- content_runs: unique threadId/clientRequestId; plan, evidence, outline, stage, execution version, lease, publication counter and errors.
- content_artifacts: unique runId/key; source/version, dependencies, review, correction count, clean/final assets and history.
- content_run_events: unique runId/sequence; ordered progress.
- ai_output_logs gains indexed runId for model/token attribution, retaining its existing 90-day TTL.

Mongoose registers schemas and indexes in the chat module. If database automatic index creation is disabled, create the indexes declared in studio.schemas.ts through the normal database migration process before enablement. No destructive migration or historical backfill is required.

The content-stages queue coordinates planning, research, writing and packaging. The content-images queue produces images. Both have worker concurrency 2; Redis leases additionally cap active image work at 2 across replicas. Run/artifact leases last two minutes and renew every 30 seconds. A 30-second reconciler recovers expired leases, re-enqueues persisted pending work and completes settled runs.

Uncertain provider outcomes become unknown and require explicit retry. Definitive rate-limit rejections allow at most two transport retries. The studio image path disables SDK retries and hidden model fallback. One quality correction is permitted per thumbnail. Success in one artifact is preserved when another fails.

Message publication is versioned atomically so a stale concurrent snapshot cannot replace newer image state. Explicit edits produce separate artifact versions/runs.

## API and UI

Existing message and streaming endpoints select the studio for enabled channels. Input additionally accepts clientRequestId, episodeId and targetArtifactId. Submission returns runId, messageId and executionVersion.

Thread-scoped endpoints:
- GET /threads/:id/runs
- GET /threads/:id/runs/:runId
- GET SSE /threads/:id/runs/:runId/events?after=N
- POST /threads/:id/runs/:runId/cancel
- POST /threads/:id/artifacts/:artifactId/retry
- POST /threads/:id/artifacts/:artifactId/revisions

Preferences: GET/PATCH /channels/:channelId/creative-preferences.

Revisions require content and clientRequestId. Retries require clientRequestId. The guard verifies parent thread ownership; the service additionally verifies run/artifact membership. Body videoId cannot override a thread's ownership.

The UI shows progress, two image slots, independent failures/retries, selected-artifact editing, versions, sources and saved preferences. Navigation/reload is passive. Cancel is explicit.

## Creative behavior

Default duration is 8-10 minutes, with a nine-minute center; explicit requests override it. Estimates use configured spoken words per minute plus one second per BEAT and two seconds per PAUSE. Only speech contributes to spoken-word count.

Script sections follow the episode. Prison/family stories prioritize lived experience and psychology; courtroom stories may explain legal developments. Formatting an existing structured script reflows tokens without changing speech. A newly pasted script takes priority over older material.

Whenever thumbnails are offered, there are exactly two. No hard four-word overlay cap or silent 70-character title truncation remains. Scene generation is separate from Sharp headline composition. The licensed Anton font is bundled in src/assets/fonts; deployment must copy these assets. Clean backgrounds permit text-only revisions without new scene generation.

Visual reference notes capture the supplied direction: expressive recognizable faces, meaningful actions, clear contrast and complete wording. Identity photographs are resolved separately. Missing references and unavailable reviews are visible limitations; no image is claimed to be the most viral without evidence.

Measured CTR examples and view-only examples are separated. View totals alone do not prove audience rejection. Current subjects take priority over unrelated old thread metadata.

## Verification

Backend commands: pnpm run build; pnpm exec jest --runInBand.

Database integration tests start a local temporary mongod when available. Set MONGOD_PATH to a binary elsewhere, or STUDIO_TEST_MONGO_URI to a dedicated test server. Each run uses a unique disposable database. Tests mock provider and queue calls and never contact production.

Frontend commands: pnpm run build; pnpm test:browser. Install its browser once using pnpm exec playwright install chromium. Browser tests use a local frontend and intercepted API responses.

Whole-repository frontend lint has legacy failures. Keep new studio components/types/tests lint-clean and compare touched legacy files against HEAD to detect introduced errors.

## Production gate and monitoring

Before enabling a production channel, verify Redis, MinIO, model access, indexes and copied font assets. Run a staging episode against the configured provider and inspect both images, exact wording, review, export and usage logs. Automated tests validate flow and composition, not subjective quality of newly generated provider images.

Observe content_runs status/stage/timestamps/error, content_artifacts review/corrections/provenance and ai_output_logs runId/studio operations. These support latency, completion rates, partial failure, correction frequency and usage tracking.

Compare CTR/retention only where published-video linkage and comparable measurements exist. Account for topic, traffic and distribution changes. Quality review is not a prediction of CTR.


## Local implementation audit fixes

The shared thumbnail rules also apply to general chat, performance/autopsy prompts, the thumbnail customization UI, empty-state suggestions and script shortcuts. No active wording hint requires three concepts or a two-to-four-word headline. Historical sample conversations remain unchanged.

The image-mode generation endpoint delegates to the coordinator on enabled channels. Editing a studio image through the old entry point resolves the authorized artifact and creates a durable revision. Old images without a studio artifact retain explicit legacy editing, as required for compatibility. Uploading an image to pin it uses the asset-only endpoint rather than sending an implicit chat request.

Selected-artifact edits retain all requested deliverables. Revision sources are tracked per artifact kind and thumbnail variant. Description/tag edits preserve the existing title, thumbnail concepts and image assets. Formatting uses deterministic parsing/reflow for structured, pasted, attached and legacy quoted scripts; no writing-model call is made. When no exact source can be identified, the run requests the source instead of inventing or rewriting it.

Scripts and packaging are linked through artifact dependencies. A final alignment review reconciles a changed promise with at most one packaging correction. Scene replacements caused by reconciliation consume the image correction allowance; an already used allowance produces needs_attention instead of another paid scene. Atomic reservations and supersession checks prevent an image worker and reconciliation from independently spending the same allowance. Replaying interrupted coordination compares persisted concepts against packaging before delivery.

Meaningful script changes invalidate dependent packaging and images, including dependencies carried through an earlier formatting revision. Metadata-only edits retain valid images. Successful revisions record lineage and a monotonic version number. A thread-scoped versions endpoint and UI show explicit script, packaging and image versions as well as image attempts. Late results cannot become the current version over a newer requested edit. Cards refresh outdated status when the thread changes.

Research now stores verified/disputed/unverified claims and supporting quoted passages, source retrieval times, limitations and the recommended angle. A verified label requires an exact supporting passage from a successfully retrieved source, not merely a model-supplied URL. HTTPS retrieval checks and pins public DNS addresses, validates redirects, limits time/content size and degrades to unverified when evidence is unavailable. Semantic interpretation still uses model review and is not a guarantee that a source is correct. Prior-coverage lookup searches matching titles across the catalog, with a 500-result review budget and an explicit limitation if more matches exist.

Additional regression coverage includes mixed revisions, successive metadata-only edits, pasted speech preservation, script dependency invalidation, formatting-then-rewriting, bounded packaging reconciliation/recovery, late worker completion, cross-thread history ownership, old catalog coverage and source retrieval boundaries. Browser coverage includes version navigation and refreshing stale output status. Provider/search calls remain mocked in automated integration tests; real provider creative evaluation remains a separate acceptance check.

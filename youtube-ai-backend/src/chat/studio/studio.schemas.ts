import { Schema } from 'mongoose';
const oid = Schema.Types.ObjectId;
const options = { timestamps: true, strict: true };
export const PreferencesSchema = new Schema(
  {
    channelId: { type: oid, required: true, unique: true },
    revision: { type: Number, default: 1 },
    enabled: { type: Boolean, default: false },
    duration: Object,
    wordsPerMinute: Number,
    instructions: [String],
    approvedExamples: [String],
    visualReferences: [String],
    visualReferenceAssets: [Object],
    identityReferences: [Object],
    excludeHost: Boolean,
    excludeLogo: Boolean,
    history: [Object],
  },
  { ...options, collection: 'creator_preferences' },
);
export const EpisodeSchema = new Schema(
  {
    channelId: { type: oid, required: true },
    threadId: { type: oid, required: true },
    revision: Number,
    brief: Object,
    preferences: Object,
    sourceRequestId: String,
  },
  { ...options, collection: 'episode_briefs' },
);
EpisodeSchema.index({ threadId: 1, sourceRequestId: 1 }, { unique: true });
export const RunSchema = new Schema(
  {
    channelId: { type: oid, required: true },
    threadId: { type: oid, required: true },
    episodeId: oid,
    clientRequestId: { type: String, required: true },
    request: Object,
    episodeRevision: Number,
    plan: Object,
    research: Object,
    outline: Object,
    preferences: Object,
    status: { type: String, default: 'queued' },
    stage: String,
    executionVersion: { type: Number, default: 1 },
    sequence: { type: Number, default: 0 },
    publicationVersion: { type: Number, default: 0 },
    messageId: oid,
    leaseUntil: Date,
    owner: String,
    error: String,
    cancelledAt: Date,
    targetArtifactId: oid,
    sources: Object,
    reusedArtifactIds: [oid],
    alignment: Object,
  },
  { ...options, collection: 'content_runs' },
);
RunSchema.index({ threadId: 1, clientRequestId: 1 }, { unique: true });
RunSchema.index({ status: 1, leaseUntil: 1 });
export const ArtifactSchema = new Schema(
  {
    channelId: { type: oid, required: true },
    threadId: { type: oid, required: true },
    episodeId: oid,
    runId: { type: oid, required: true },
    key: { type: String, required: true },
    kind: String,
    version: { type: Number, default: 1 },
    sourceArtifactId: oid,
    rootArtifactId: oid,
    requestedAt: Date,
    supersededBy: oid,
    supersededRequestAt: Date,
    supersededRunId: oid,
    currentArtifactId: oid,
    versionCounter: Number,
    latestRequestAt: Date,
    latestRequestRunId: oid,
    episodeRevision: Number,
    status: { type: String, default: 'pending' },
    data: Object,
    review: Object,
    corrections: { type: Number, default: 0 },
    providerStarted: Boolean,
    owner: String,
    leaseUntil: Date,
    error: String,
    history: [Object],
    dependencies: [oid],
    outdated: { type: Boolean, default: false },
    provenance: Object,
  },
  { ...options, collection: 'content_artifacts' },
);
ArtifactSchema.index({ runId: 1, key: 1 }, { unique: true });
ArtifactSchema.index({ status: 1, leaseUntil: 1 });
ArtifactSchema.index({ threadId: 1, rootArtifactId: 1, createdAt: 1 });
export const EventSchema = new Schema(
  {
    channelId: oid,
    threadId: oid,
    runId: { type: oid, required: true },
    sequence: { type: Number, required: true },
    type: String,
    payload: Object,
  },
  { ...options, collection: 'content_run_events' },
);
EventSchema.index({ runId: 1, sequence: 1 }, { unique: true });
export const STUDIO_MODELS = [
  { name: 'CreatorPreferences', schema: PreferencesSchema },
  { name: 'EpisodeBrief', schema: EpisodeSchema },
  { name: 'ContentRun', schema: RunSchema },
  { name: 'ContentArtifact', schema: ArtifactSchema },
  { name: 'ContentRunEvent', schema: EventSchema },
];

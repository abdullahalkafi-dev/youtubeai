export type Deliverable =
  | 'script'
  | 'packaging'
  | 'analysis'
  | 'outline'
  | 'answer'
  | 'scene';
export type ReviewStatus = 'pass' | 'repair' | 'needs_attention';
export interface Review {
  status: ReviewStatus;
  issues: string[];
  instruction?: string;
}
export interface RequestPlan {
  /** Artifacts the client's feedback refers to, resolved from the active artifact list. */
  targets?: Array<{ artifactId: string; change: string }>;
  /** Details the client explicitly asked for (e.g. a head bandage); never flagged as invented. */
  clientRequestedDetails?: string[];
  packagingChanges?: Array<'title' | 'description' | 'tags' | 'thumbnails'>;
  referenceRoles?: Array<{
    url: string;
    role: 'identity' | 'style' | 'source';
  }>;
  action: 'create' | 'revise' | 'format' | 'analyze' | 'recommend' | 'answer';
  topic: string;
  subjects: string[];
  promise: string;
  emphasis: 'prison' | 'family' | 'courtroom' | 'street' | 'mixed';
  mode: 'new' | 'existing';
  deliverables: Deliverable[];
  thumbnails: boolean;
  research: boolean;
  newEpisode: boolean;
  duration: { min: number; max: number };
  questions: string[];
  standingPreferences: string[];
}
export interface SpokenSection {
  title: string;
  purpose: string;
  blocks: Array<{ lines: string[]; cue?: 'BEAT' | 'PAUSE' }>;
  jewel?: string[];
}
export interface ScriptArtifact {
  title: string;
  sections: SpokenSection[];
  notes?: string[];
}
export interface ThumbnailConcept {
  text: string;
  visual: string;
  colors: string;
  emotion: string;
  textSide: 'left' | 'right';
  aspectRatio: '16:9' | '9:16';
  excludeHost?: boolean;
  excludeLogo?: boolean;
  /** Short chip above the headline, e.g. REPORTED. */
  tag?: string;
  /** Small corner disclosure, e.g. ILLUSTRATION. */
  label?: string;
}
export interface PackagingBrief {
  title: string;
  description?: string;
  tags?: string[];
  thumbnails: ThumbnailConcept[];
  rationale: string;
}
export interface ReferenceAsset {
  url: string;
  role: 'style' | 'counterexample';
  note?: string;
}
export const DEFAULT_PREFERENCES = {
  revision: 1,
  enabled: false,
  duration: { min: 7, max: 9 },
  wordsPerMinute: 130,
  instructions: [] as string[],
  approvedExamples: [] as string[],
  visualReferences: [] as string[],
  /** Approved reference images: style = direction to follow, counterexample = pattern to avoid. */
  visualReferenceAssets: [] as ReferenceAsset[],
  /** Subject name to face photo used before any web lookup. */
  identityReferences: [] as Array<{ name: string; url: string }>,
  excludeHost: false,
  excludeLogo: false,
};
export const TERMINAL = [
  'completed',
  'completed_with_issues',
  'failed',
  'cancelled',
  'waiting_for_input',
];
export function parseJson<T>(raw: string): T {
  const clean = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  return JSON.parse(clean) as T;
}
export function normalizePlan(
  input: RequestPlan,
  request: string,
  defaults = DEFAULT_PREFERENCES.duration,
): RequestPlan {
  if (
    !input ||
    typeof input.topic !== 'string' ||
    !Array.isArray(input.deliverables)
  )
    throw new Error('Invalid request plan');
  const allowed: Deliverable[] = [
    'script',
    'packaging',
    'analysis',
    'outline',
    'answer',
    'scene',
  ];
  if (
    !['create', 'revise', 'format', 'analyze', 'recommend', 'answer'].includes(
      input.action,
    )
  )
    throw new Error('Invalid action');
  if (
    !['prison', 'family', 'courtroom', 'street', 'mixed'].includes(
      input.emphasis,
    )
  )
    throw new Error('Invalid content emphasis');
  input.targets = Array.isArray(input.targets)
    ? input.targets
        .filter(
          (t) =>
            t &&
            typeof t.artifactId === 'string' &&
            /^[a-f0-9]{24}$/i.test(t.artifactId),
        )
        .slice(0, 6)
        .map((t) => ({
          artifactId: t.artifactId,
          change: typeof t.change === 'string' ? t.change.slice(0, 500) : '',
        }))
    : [];
  input.clientRequestedDetails = Array.isArray(input.clientRequestedDetails)
    ? input.clientRequestedDetails
        .filter((x) => typeof x === 'string' && x.trim())
        .map((x) => x.trim().slice(0, 200))
        .slice(0, 12)
    : [];
  input.packagingChanges = Array.isArray(input.packagingChanges)
    ? input.packagingChanges.filter((field) =>
        ['title', 'description', 'tags', 'thumbnails'].includes(field),
      )
    : [];
  input.promise =
    typeof input.promise === 'string' ? input.promise : input.topic;
  input.thumbnails = input.thumbnails === true;
  input.research = input.research === true;
  input.newEpisode = input.newEpisode === true;
  input.deliverables = [
    ...new Set(input.deliverables.filter((x) => allowed.includes(x))),
  ];
  if (!input.deliverables.length) input.deliverables = ['answer'];
  input.subjects = Array.isArray(input.subjects)
    ? input.subjects.filter((x) => typeof x === 'string')
    : [];
  input.questions = Array.isArray(input.questions)
    ? input.questions.filter((x) => typeof x === 'string')
    : [];
  input.standingPreferences =
    /\b(always|from now on|for future|remember|every time)\b/i.test(request)
      ? (Array.isArray(input.standingPreferences)
          ? input.standingPreferences
          : []
        )
          .filter((x) => typeof x === 'string')
          .slice(0, 10)
      : [];
  const explicitRequest = request.includes('[USER REQUEST]')
    ? request.split('[USER REQUEST]').pop()!
    : request;
  const range = explicitRequest.match(
    /\b(\d{1,3})(?:\s*(?:-|–|to)\s*(\d{1,3}))?\s*[- ]?minutes?\b/i,
  );
  input.duration = range
    ? { min: +range[1], max: +(range[2] || range[1]) }
    : { ...defaults };
  if (
    input.duration.min < 1 ||
    input.duration.max < input.duration.min ||
    input.duration.max > 180
  )
    throw new Error('Duration must be between 1 and 180 minutes');
  if (
    input.action === 'format' &&
    !/\b(title|thumbnail|SEO|description|tags)\b/i.test(explicitRequest)
  ) {
    input.deliverables = ['script'];
    input.thumbnails = false;
    input.research = false;
  }
  if (input.thumbnails && !input.deliverables.includes('packaging'))
    input.deliverables.push('packaging');
  return input;
}
/** Publication limits enforced by YouTube. Characters, not words. */
export const YOUTUBE_LIMITS = { title: 100, description: 5000, tags: 500 };
export function validatePackaging(
  pack: PackagingBrief,
  thumbnails: boolean,
): void {
  if (
    !pack ||
    typeof pack.title !== 'string' ||
    !pack.title.trim() ||
    !Array.isArray(pack.thumbnails)
  )
    throw new Error('Invalid packaging brief');
  // YouTube's hard limits. A title is rewritten shorter by the model, never silently cut.
  if (pack.title.length > YOUTUBE_LIMITS.title)
    throw new Error(
      `Title is ${pack.title.length} characters; YouTube allows at most ${YOUTUBE_LIMITS.title}. Rewrite it shorter without losing the meaning.`,
    );
  if ((pack.description || '').length > YOUTUBE_LIMITS.description)
    throw new Error(
      `Description exceeds YouTube's ${YOUTUBE_LIMITS.description}-character limit; shorten it.`,
    );
  if ((pack.tags || []).join(',').length > YOUTUBE_LIMITS.tags)
    throw new Error(
      `Tags exceed YouTube's ${YOUTUBE_LIMITS.tags}-character combined limit; remove the weakest tags.`,
    );
  if (pack.thumbnails.length !== (thumbnails ? 2 : 0))
    throw new Error(
      'Packaging must have exactly two thumbnail variants when thumbnails are offered',
    );
  for (const concept of pack.thumbnails) {
    if (
      !concept.text?.trim() ||
      !concept.visual?.trim() ||
      !concept.emotion?.trim()
    )
      throw new Error('Incomplete thumbnail concept');
    concept.aspectRatio = concept.aspectRatio === '9:16' ? '9:16' : '16:9';
    concept.textSide = concept.textSide === 'right' ? 'right' : 'left';
  }
}
export function validateScript(script: ScriptArtifact): void {
  if (
    typeof script?.title !== 'string' ||
    !Array.isArray(script.sections) ||
    !script.sections.length
  )
    throw new Error('Script has no sections');
  for (const section of script.sections) {
    if (
      !section.title ||
      !Array.isArray(section.blocks) ||
      !section.blocks.length
    )
      throw new Error('Incomplete script section');
    if (
      section.jewel &&
      (!Array.isArray(section.jewel) ||
        section.jewel.some((x) => typeof x !== 'string'))
    )
      throw new Error('Invalid jewel');
    for (const block of section.blocks)
      if (
        !Array.isArray(block.lines) ||
        !block.lines.length ||
        block.lines.some((x) => typeof x !== 'string') ||
        (block.cue && !['BEAT', 'PAUSE'].includes(block.cue))
      )
        throw new Error('Invalid spoken block');
  }
}
export function scriptTiming(script: ScriptArtifact, wpm = 130) {
  const blocks = script.sections.flatMap((s) => s.blocks);
  const text = [
    ...blocks.flatMap((b) => b.lines),
    ...script.sections.flatMap((s) => s.jewel || []),
  ].join(' ');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const pauses =
    blocks.reduce(
      (n, b) => n + (b.cue === 'PAUSE' ? 2 : b.cue === 'BEAT' ? 1 : 0),
      0,
    ) +
    script.sections.filter((s) => s.jewel?.length).length * 2;
  return {
    words,
    seconds: Math.round((words / wpm) * 60 + pauses),
    wordsPerMinute: wpm,
  };
}
export function renderScript(script: ScriptArtifact): string {
  return (
    `<!-- SCRIPT_START -->\n# SCRIPT TITLE: ${script.title}\n\n` +
    script.sections
      .map(
        (s, i) =>
          `## **${i + 1}. ${s.title}**\n\n` +
          s.blocks
            .map(
              (b) =>
                b.lines.map((l) => `> ${l}`).join('\n') +
                (b.cue ? `\n\n[${b.cue}]` : ''),
            )
            .join('\n\n') +
          (s.jewel?.length
            ? '\n\n### **JEWEL**\n\n' +
              s.jewel.map((l) => `> ${l}`).join('\n') +
              '\n\n[PAUSE]'
            : ''),
      )
      .join('\n\n') +
    '\n<!-- SCRIPT_END -->'
  );
}
export function renderPackaging(pack: PackagingBrief) {
  return (
    `## Title\n${pack.title}\n\n${pack.rationale || ''}` +
    (pack.description ? `\n\n## Description\n${pack.description}` : '') +
    (pack.tags?.length ? `\n\n## Tags\n${pack.tags.join(', ')}` : '') +
    (pack.thumbnails.length
      ? '\n\n<!-- THUMBNAILS_START -->\n' +
        pack.thumbnails
          .map(
            (c, i) =>
              `### Concept ${i + 1}\n**Text overlay:** ${c.text.replace(/\n/g, ' / ')}\n**Visual concept:**\n${c.visual}\nExpression: ${c.emotion}\n**Color scheme:** ${c.colors}`,
          )
          .join('\n\n') +
        '\n<!-- THUMBNAILS_END -->'
      : '')
  );
}

/** Formatting preserves every spoken token and only reflows lines. */
export function reflowScript(script: ScriptArtifact): ScriptArtifact {
  validateScript(script);
  return {
    ...script,
    sections: script.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => {
        const words = block.lines.join(' ').trim().split(/\s+/).filter(Boolean);
        const lines: string[] = [];
        for (let i = 0; i < words.length; i += 7)
          lines.push(words.slice(i, i + 7).join(' '));
        return { ...block, lines };
      }),
    })),
  };
}

/** Attached video context is eligible only when it matches every explicit subject. */
export function matchesEpisodeSubjects(
  title: string,
  subjects: string[],
): boolean {
  const text = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return subjects.every((subject) => {
    const tokens = subject
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4);
    return (
      tokens.length > 0 &&
      tokens.some((token) => text.split(' ').includes(token))
    );
  });
}

/** One plain sentence telling the client what is about to happen (no model call). */
export function describePlan(plan: RequestPlan): string {
  const parts: string[] = [];
  if (plan.deliverables.includes('script'))
    parts.push(
      plan.action === 'format'
        ? 'reformat your script without changing its words'
        : 'write a script of about ' +
            Math.round((plan.duration.min + plan.duration.max) / 2) +
            ' minutes',
    );
  if (plan.deliverables.includes('outline')) parts.push('plan the outline');
  if (plan.deliverables.includes('packaging')) {
    const fields = plan.packagingChanges?.length
      ? plan.packagingChanges.filter((f) => f !== 'thumbnails')
      : [];
    parts.push(
      fields.length ? 'update the ' + fields.join(' and ') : 'build the title and metadata',
    );
  }
  if (plan.thumbnails)
    parts.push('create two thumbnails and generate both images automatically');
  if (plan.deliverables.includes('analysis')) parts.push('analyze the evidence');
  if (!parts.length) return '';
  return (
    (plan.research ? 'I will research this first, then ' : 'I will ') +
    (parts.length > 1
      ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]
      : parts[0]) +
    '.'
  );
}

/** What was produced, for the closing line of a finished run. */
export function describeOutcome(
  artifacts: Array<{ kind: string; status: string; outdated?: boolean; data?: any }>,
  revised: boolean,
): string {
  const live = artifacts.filter((a) => !a.outdated && a.status === 'ready');
  const made: string[] = [];
  const script = live.find((a) => a.kind === 'script');
  if (script)
    made.push(
      'script' +
        (script.data?.timing
          ? ' (about ' + Math.round(script.data.timing.seconds / 60) + ' min, estimated)'
          : ''),
    );
  const pack = live.find((a) => a.kind === 'packaging');
  if (pack) made.push('title' + (pack.data?.description ? ' and description' : ''));
  const images = live.filter((a) => ['thumbnail', 'scene'].includes(a.kind)).length;
  if (images) made.push(images + (images === 1 ? ' image' : ' images'));
  if (!made.length) return '';
  return (
    '**Done:** ' +
    made.join(', ') +
    '.' +
    (revised ? ' Everything you did not ask to change was kept as it was.' : '')
  );
}

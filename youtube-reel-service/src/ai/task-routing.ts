/**
 * Per-task model routing and cost estimation. Pure helpers (no OpenAI, no database).
 *
 * The task label of a model call is "<kind>:<id...>" (for example "mining:abc:2/5"); routing is by <kind>.
 * OPENAI_REEL_TASK_MODELS="mining=gpt-6-luna,source-select=gpt-6-luna" sends those kinds to another model;
 * OPENAI_REEL_TASK_EFFORT="mining=medium" changes their reasoning effort. Empty = everything as before.
 */

export interface Price {
  /** US dollars per 1M prompt tokens. */
  in: number;
  /** US dollars per 1M completion tokens (reasoning tokens are billed as output). */
  out: number;
}

export function taskKind(task: string): string {
  return task.split(':')[0];
}

/** "a=b,c=d" -> Map. Blank entries and entries without "=" are ignored. */
export function parsePairs(s: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (s ?? '').split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && v) out.set(k, v);
  }
  return out;
}

/** "gpt-6.1-sol=2:10,gpt-6-luna=0.1:0.5" -> { model: { in, out } } (dollars per 1M tokens). */
export function parsePrices(s: string): Record<string, Price> {
  const out: Record<string, Price> = {};
  for (const [model, v] of parsePairs(s)) {
    const [i, o] = v.split(':').map(Number);
    if (Number.isFinite(i) && Number.isFinite(o)) out[model] = { in: i, out: o };
  }
  return out;
}

/** Mongo field names must not contain dots or start with $: "gpt-6.1-sol" is stored as "gpt-6_1-sol". */
export function modelKey(model: string): string {
  return model.replace(/[.$]/g, '_');
}

export type ModelTokens = Record<string, { prompt?: number; completion?: number }>;

/**
 * Estimated model cost in US dollars. Usage recorded before per-model tracking existed has no model split:
 * it is priced as if it all ran on `fallbackModel`.
 */
export function estimateCostUsd(models: ModelTokens | undefined, totals: { promptTokens?: number; completionTokens?: number }, prices: Record<string, Price>, fallbackModel: string): number {
  const byKey: Record<string, Price> = {};
  for (const [m, p] of Object.entries(prices)) byKey[modelKey(m)] = p;
  let cost = 0;
  let seenPrompt = 0;
  let seenCompletion = 0;
  for (const [k, t] of Object.entries(models ?? {})) {
    const p = byKey[k] ?? byKey[modelKey(fallbackModel)];
    if (!p) continue;
    cost += ((t.prompt ?? 0) / 1e6) * p.in + ((t.completion ?? 0) / 1e6) * p.out;
    seenPrompt += t.prompt ?? 0;
    seenCompletion += t.completion ?? 0;
  }
  const rest = byKey[modelKey(fallbackModel)];
  if (rest) {
    cost += (Math.max(0, (totals.promptTokens ?? 0) - seenPrompt) / 1e6) * rest.in + (Math.max(0, (totals.completionTokens ?? 0) - seenCompletion) / 1e6) * rest.out;
  }
  return Math.round(cost * 1000) / 1000;
}

/** Adds the per-model token split of `b` to `a` (for a campaign and its hidden explore part). */
export function mergeModelTokens(a: ModelTokens | undefined, b: ModelTokens | undefined): ModelTokens {
  const out: ModelTokens = {};
  for (const src of [a, b]) {
    for (const [k, t] of Object.entries(src ?? {})) {
      out[k] = { prompt: (out[k]?.prompt ?? 0) + (t.prompt ?? 0), completion: (out[k]?.completion ?? 0) + (t.completion ?? 0) };
    }
  }
  return out;
}

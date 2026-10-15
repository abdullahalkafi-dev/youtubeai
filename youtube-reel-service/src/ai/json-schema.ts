import { z } from 'zod';

const KEEP = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'anyOf', 'description', 'const']);

/**
 * Convert a zod schema into the JSON-schema subset accepted by OpenAI strict structured outputs:
 * every object closed (additionalProperties:false) and every property required.
 * Numeric/length limits are dropped from the wire schema (kept in descriptions + zod validation).
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as Record<string, unknown>;
  return sanitize(raw) as Record<string, unknown>;
}

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize);
  if (!node || typeof node !== 'object') return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (!KEEP.has(k)) continue;
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, sanitize(pv)]));
    } else if (k === 'items' || k === 'anyOf') {
      out[k] = sanitize(v);
    } else {
      out[k] = v;
    }
  }
  if (out.type === 'object' || out.properties) {
    out.type = 'object';
    out.properties = out.properties ?? {};
    out.required = Object.keys(out.properties as object);
    out.additionalProperties = false;
  }
  return out;
}

import type { Schema } from 'mongoose';

/**
 * Soft delete for reels and campaigns ("Delete campaign" hides it from the app; nothing is removed from YouTube).
 * Every find / count / aggregate ignores documents with `deletedAt` set, unless the query opts in with
 * `.setOptions({ withDeleted: true })` (aggregate: `.option({ withDeleted: true })`). Updates are NOT filtered, so the
 * delete itself and housekeeping can still reach the documents.
 */
export function softDelete(schema: Schema) {
  const hide = function (this: any) {
    if (!this.getOptions?.().withDeleted) this.where({ deletedAt: null });
  };
  for (const op of ['find', 'findOne', 'countDocuments', 'findOneAndUpdate'] as const) schema.pre(op, hide);
  schema.pre('aggregate', function (this: any) {
    if (this.options?.withDeleted) return;
    this.pipeline().unshift({ $match: { deletedAt: null } });
  });
}

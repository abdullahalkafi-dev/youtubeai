/** When a published post's numbers are captured: dense early (the first day decides a Short), sparse later. */
export const CHECKPOINT_HOURS = [1, 3, 6, 12, 24, 48, 72, 168, 336, 672, 1440, 2160] as const;

export function checkpointLabel(hours: number): string {
  return hours < 72 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/** The time of checkpoint `index` after publishing, or undefined once the tracking window (default 90 days) is over. */
export function checkpointAt(publishedAt: Date, index: number, maxAgeDays = 90): Date | undefined {
  const hours = CHECKPOINT_HOURS[index];
  if (hours === undefined || hours > maxAgeDays * 24) return undefined;
  return new Date(publishedAt.getTime() + hours * 3_600_000);
}

export const firstCheckpointAt = (publishedAt: Date, maxAgeDays = 90) => checkpointAt(publishedAt, 0, maxAgeDays);

/**
 * Index of the checkpoint a snapshot taken at `now` satisfies, and the index to wait for next.
 * If the service was down and several checkpoints are overdue, one snapshot covers them all (no catch-up spam).
 */
export function advance(publishedAt: Date, now: Date, maxAgeDays = 90): { reached: number; next: number | undefined; label: string } {
  const ageHours = (now.getTime() - publishedAt.getTime()) / 3_600_000;
  let reached = -1;
  for (let i = 0; i < CHECKPOINT_HOURS.length; i++) if (CHECKPOINT_HOURS[i] <= ageHours + 1e-9) reached = i;
  const nextIdx = reached + 1;
  const next = checkpointAt(publishedAt, nextIdx, maxAgeDays) ? nextIdx : undefined;
  return { reached: Math.max(reached, 0), next, label: checkpointLabel(CHECKPOINT_HOURS[Math.max(reached, 0)]) };
}

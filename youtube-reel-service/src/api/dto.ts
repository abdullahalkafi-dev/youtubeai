import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const ytId = z.string().regex(/^[A-Za-z0-9_-]{11}$/, 'Invalid YouTube video id');

export const CreateCampaignDto = z
  .object({
    brief: z.string().trim().min(8, 'Describe the campaign in a sentence (min 8 characters)').max(600),
    name: z.string().trim().max(120).optional(),
    targetReels: z.number().int().min(1).max(15).default(5),
    minSec: z.number().int().min(15).max(90).default(30),
    maxSec: z.number().int().min(20).max(120).default(60),
    allowCrossVideo: z.boolean().default(true),
    seedVideoIds: z.array(ytId).max(5).default([]),
  })
  .refine((d) => d.maxSec >= d.minSec + 10, { message: 'Max duration must be at least 10s more than min', path: ['maxSec'] });
export type CreateCampaignInput = z.infer<typeof CreateCampaignDto>;

export const PatchReelDto = z.object({
  status: z.enum(['todo', 'posted', 'rejected']).optional(),
  postedUrl: z.string().trim().url().max(300).nullable().optional(),
  rejectReason: z.string().trim().max(300).optional(),
  rejectKind: z.enum(['bad_moment', 'other']).optional(),
  packaging: z
    .object({
      headline: z.string().trim().min(2).max(60).optional(),
      title: z.string().trim().min(2).max(100).optional(),
      description: z.string().trim().max(5000).optional(),
      tags: z.array(z.string().trim().max(60)).max(30).optional(),
      hashtags: z.array(z.string().trim().max(40)).max(8).optional(),
      pinnedComment: z.string().trim().max(500).optional(),
    })
    .optional(),
});
export type PatchReelInput = z.infer<typeof PatchReelDto>;

export const CookiesDto = z.object({ cookies: z.string().min(50).max(200_000) });

export const ListReelsQuery = z.object({
  status: z.enum(['queued', 'rendering', 'todo', 'posted', 'rejected', 'failed']).optional(),
  campaignId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  entity: z.string().max(80).optional(),
  period: z.enum(['7d', '30d', 'all']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(48),
  skip: z.coerce.number().int().min(0).default(0),
});

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return r.data;
}

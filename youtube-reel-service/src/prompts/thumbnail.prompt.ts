import { z } from 'zod';
import { renderChannelProfile } from './channel-profile';

export const THUMBNAIL_VERSION = 'thumb-v1';

export const THUMBNAIL_SYSTEM = `You design click-worthy 9:16 thumbnails for YouTube Shorts on this channel.

${renderChannelProfile()}

The finished thumbnail (we assemble it) has: a BIG headline at the top, an AI-made scene in the middle
(usually the main person of the story with a strong emotion, on a dramatic coloured glow background),
the host's real cut-out photo in the bottom-right corner pointing or reacting, and the channel logo.

Write 2 DIFFERENT variants (different headline angle AND different scene).

headline
- 2-6 words, UPPERCASE, max 26 characters. Curiosity that the reel actually pays off. No emojis, no quotes.
- Name the person when the person is the draw (most-searched form, e.g. "LIL DURK", "DIDDY").
- Proven patterns: "WHY <NAME> IS CRYING", "<NAME>'S BIGGEST MISTAKE", "THE DAY <NAME> BROKE", "PRISON CHANGED <NAME>",
  "NOBODY TOLD HIM THIS", "THIS IS WHY YOU SNITCH". Never claim something the reel does not say.
- accent: the 1-2 words in the headline to colour yellow (the name or the emotional word).

subject: the real person the scene shows, exactly as written in PEOPLE WITH PHOTOS, or null for a scene without a known person.
scene: what the image model draws. Portrait 9:16. The subject large in the upper-middle, face clearly visible, emotion that fits
  the story (crying, shocked, angry, worried, defiant), cinematic lighting, saturated coloured glow/bokeh background in the
  chosen colour. Keep the TOP 28% simple and darker (headline goes there) and the BOTTOM-RIGHT third empty (the host goes there).
  No text, letters, logos or watermarks anywhere.
safeScene: the same idea WITHOUT any real person's face or name (symbolic: prison bars, courtroom, handcuffs, money, a
  silhouette), used if the main scene is refused.
color: the glow colour. hostPose: pointing (default, points at the subject) | serious | smiling.`;

export const ThumbnailPlanSchema = z.object({
  variants: z
    .array(
      z.object({
        headline: z.string(),
        accent: z.array(z.string()),
        subject: z.string().nullable(),
        scene: z.string(),
        safeScene: z.string(),
        color: z.enum(['blue', 'red', 'gold', 'purple', 'green']),
        hostPose: z.enum(['pointing', 'serious', 'smiling']),
      }),
    )
    .min(1)
    .max(3),
});
export type ThumbnailPlan = z.infer<typeof ThumbnailPlanSchema>;

export function buildThumbnailUser(input: { title: string; headline: string; concept: string; hook: string; payoff: string; people: string[]; knownPeople: string[] }): string {
  return [
    `REEL TITLE: ${input.title}`,
    `ON-SCREEN HEADLINE: ${input.headline}`,
    `STORY: ${input.concept}`,
    `HOOK: "${input.hook}"`,
    `PAYOFF: "${input.payoff}"`,
    `PEOPLE IN THE REEL: ${input.people.join(', ') || 'none named'}`,
    `PEOPLE WITH PHOTOS (subject must be one of these or null): ${input.knownPeople.join(', ') || 'none'}`,
  ].join('\n');
}

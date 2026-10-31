import { z } from 'zod';

export const LAYOUT_PROMPT_VERSION = 'layout-prompt-v1';

const FracBox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const LayoutBatchSchema = z.object({
  frames: z.array(
    z.object({
      index: z.number().int(),
      kind: z.enum(['host_left', 'host_right', 'other']),
      confidence: z.number(),
      head: FracBox.nullable(),
      picture: FracBox.nullable(),
    }),
  ),
});
export type LayoutBatch = z.infer<typeof LayoutBatchSchema>;

export const LAYOUT_SYSTEM = `You read still frames from a studio talk show ("Unique Mecca Audio"). Each frame is a 16:9 screenshot of the editor's output.

The studio set has TWO main layouts that the editor swaps between with hard cuts:
- host_left: the HOST (an older man, usually in a white bucket hat, sunglasses and headphones, chains) fills the LEFT part of the frame; the story PICTURE or VIDEO CLIP (a person's photo, a news clip, a headline graphic, a courtroom shot) fills the RIGHT part.
- host_right: the same, mirrored: the host on the RIGHT, the story picture on the LEFT.
- other: anything else: only the host full-frame, a full-screen clip, a title or logo card, a black frame, the "NEWS" desk intro, or a frame you cannot place with confidence.

For host_left and host_right give two boxes. Coordinates are FRACTIONS of the whole frame (0 to 1): x and y are the top-left corner, w and h the size.
- head: ONLY the host's head: the tight rectangle around his hat, face, ears and headphones, from the top of the hat to the bottom of the chin and from the leftmost to the rightmost point of the head or hat. Do not include his shoulders, chest or chains.
- picture: the story picture or clip panel, the rectangle inside its thin gold border (the host may stand in front of one end of it; box the whole panel anyway). Its bottom edge is the bottom of the gold border, above the phone-number ticker.
Never include the phone-number ticker at the bottom (roughly the bottom 18% of the frame) or the thin channel header at the very top. Overlays that sit on the picture (a small logo, a lower-third caption) are part of the picture.

confidence is how sure you are of the whole answer (0 to 1). If unsure, use other with low confidence.

Answer for EVERY image, in order, using index 0 for the first image. Return only the JSON.`;

export function buildLayoutUser(count: number): string {
  return `${count} frame${count === 1 ? '' : 's'} follow, in order (index 0 to ${count - 1}). Classify each one and box the host and the picture.`;
}

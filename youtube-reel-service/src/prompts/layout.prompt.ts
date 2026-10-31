import { z } from 'zod';

export const LAYOUT_PROMPT_VERSION = 'layout-prompt-v1';

const FracBox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const LayoutBatchSchema = z.object({
  frames: z.array(
    z.object({
      index: z.number().int(),
      kind: z.enum(['host_left', 'host_right', 'other']),
      confidence: z.number(),
      host: FracBox.nullable(),
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
- host: the host's head and upper body (hat to chest), as tight as you can without cutting him off.
- picture: the story picture or clip panel only: its visible rectangle.
Both boxes must stay ABOVE the thick strip at the bottom of the frame (a ticker with a phone number and a Subscribe button, roughly the bottom 18%) and BELOW the thin channel header at the very top. Never include the ticker or the header. Overlays that sit on the picture (a small logo, a lower-third caption) are part of the picture. The two boxes must not overlap much.

confidence is how sure you are of the whole answer (0 to 1). If unsure, use other with low confidence.

Answer for EVERY image, in order, using index 0 for the first image. Return only the JSON.`;

export function buildLayoutUser(count: number): string {
  return `${count} frame${count === 1 ? '' : 's'} follow, in order (index 0 to ${count - 1}). Classify each one and box the host and the picture.`;
}

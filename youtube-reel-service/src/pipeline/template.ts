import { z } from 'zod';

/**
 * Admin-managed reel template: a fixed 1080x1920 PNG canvas with a transparent "window" where the
 * zoomed source video plays, plus where the per-reel headline and captions are drawn.
 * Not editable by the client — replaced by the operator via the CLI.
 */
export const TemplateSchema = z.object({
  name: z.string().default('default'),
  width: z.number().int().default(1080),
  height: z.number().int().default(1920),
  canvas: z.string().default('canvas.png'),
  window: z.object({
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int(),
    h: z.number().int(),
  }),
  /** 0..1 horizontal / vertical crop focus inside the source frame (0.5 = centre). */
  focusX: z.number().min(0).max(1).default(0.5),
  focusY: z.number().min(0).max(1).default(0.5),
  headline: z.object({
    enabled: z.boolean().default(true),
    font: z.string().default('Anton'),
    size: z.number().default(124),
    minSize: z.number().default(84),
    /** Average uppercase glyph width as a fraction of font size, as rendered by libass (Anton ≈ 0.27). */
    charWidth: z.number().default(0.27),
    color: z.string().default('#FFFFFF'),
    accentColor: z.string().default('#FFD400'),
    outlineColor: z.string().default('#000000'),
    outline: z.number().default(4),
    centerX: z.number().default(540),
    top: z.number().default(250),
    maxWidth: z.number().default(960),
    maxLines: z.number().int().default(2),
    uppercase: z.boolean().default(true),
  }),
  captions: z.object({
    enabled: z.boolean().default(true),
    font: z.string().default('Montserrat ExtraBold'),
    size: z.number().default(92),
    color: z.string().default('#FFFFFF'),
    highlightColor: z.string().default('#FFD400'),
    outlineColor: z.string().default('#000000'),
    outline: z.number().default(6),
    shadow: z.number().default(2),
    centerX: z.number().default(540),
    centerY: z.number().default(1235),
    maxWordsPerChunk: z.number().int().default(3),
    maxCharsPerChunk: z.number().int().default(18),
    uppercase: z.boolean().default(true),
  }),
});
export type ReelTemplate = z.infer<typeof TemplateSchema>;

export function parseTemplate(raw: unknown): ReelTemplate {
  const t = TemplateSchema.parse(raw);
  const { window: w } = t;
  if (w.x < 0 || w.y < 0 || w.w <= 0 || w.h <= 0 || w.x + w.w > t.width || w.y + w.h > t.height) {
    throw new Error(`Template window ${JSON.stringify(w)} is outside the ${t.width}x${t.height} canvas`);
  }
  if (w.w % 2 || w.h % 2) throw new Error('Template window width/height must be even numbers (video encoding requirement)');
  return t;
}

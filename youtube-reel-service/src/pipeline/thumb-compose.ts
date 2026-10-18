import { assColor, layoutHeadline } from './captions';

/** 9:16 thumbnail canvas. */
export const THUMB_W = 1080;
export const THUMB_H = 1920;
/** What the image model is asked for (multiples of 16, ≈ 9:16), then cover-fitted to the canvas. */
export const THUMB_SCENE_SIZE = '1088x1936';

const YELLOW = '#FFE600';

/** Host cut-out per pose (files in assets/thumb). Higher-resolution cut-outs preferred where the pose allows. */
export const HOST_POSES: Record<'pointing' | 'serious' | 'smiling', string[]> = {
  pointing: ['host_3.png'],
  serious: ['host_5.png', 'host_4.png'],
  smiling: ['host_7.png', 'host_6.png'],
};

/** Headline as ASS: Anton, white with yellow accent words, heavy outline + shadow, top-centre. */
export function buildThumbAss(headline: string, accent: string[]): string {
  const { lines, size } = layoutHeadline(headline, {
    enabled: true,
    font: 'Anton',
    size: 200,
    minSize: 118,
    charWidth: 0.3,
    color: '#FFFFFF',
    accentColor: YELLOW,
    outlineColor: '#000000',
    outline: 9,
    centerX: THUMB_W / 2,
    top: 170,
    maxWidth: 1000,
    maxLines: 3,
    uppercase: true,
  });
  const accentSet = new Set(
    accent
      .flatMap((a) => a.toUpperCase().split(/\s+/))
      .map((w) => w.replace(/[^A-Z0-9']/g, ''))
      .filter(Boolean),
  );
  const white = assColor('#FFFFFF');
  const yellow = assColor(YELLOW);
  const text = lines
    .map((line) =>
      line
        .split(' ')
        .map((w) => (accentSet.has(w.replace(/[^A-Z0-9']/g, '')) ? `{\\c${yellow}}${w}{\\c${white}}` : w))
        .join(' '),
    )
    .join('\\N');
  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${THUMB_W}`,
    `PlayResY: ${THUMB_H}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Thumb,Anton,${size},${white},${white},${assColor('#000000')},${assColor('#000000', 0x40)},0,0,0,0,100,100,1,0,1,9,5,8,30,30,0,1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 1,0:00:00.00,0:00:05.00,Thumb,,0,0,0,,{\\an8\\pos(${THUMB_W / 2},170)}${text}`,
    '',
  ].join('\n');
}

/**
 * ffmpeg graph. Inputs: 0 scene image, 1 host cut-out (PNG with alpha), 2 logo.
 * Scene cover-fitted; dark gradient behind the headline; host bottom-right; logo top-left; headline burned last.
 */
export function thumbGraph(assFile: string, fontsDir: string): string {
  return [
    `[0:v]scale=${THUMB_W}:${THUMB_H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${THUMB_W}:${THUMB_H},setsar=1,format=rgba[bg]`,
    `color=c=black:s=${THUMB_W}x820,format=rgba,geq=r=0:g=0:b=0:a='200*pow(1-Y/H\\,1.6)'[grad]`,
    `[bg][grad]overlay=x=0:y=0[b1]`,
    `[1:v]format=rgba,despill=type=green:mix=0.6:expand=0.2,scale=w=780:h=940:force_original_aspect_ratio=decrease:flags=lanczos[host]`,
    `[b1][host]overlay=x=main_w-overlay_w+30:y=main_h-overlay_h[b2]`,
    `[2:v]scale=-1:120:flags=lanczos[logo]`,
    `[b2][logo]overlay=x=34:y=34[b3]`,
    `[b3]ass=${assFile}:fontsdir=${fontsDir},format=yuv420p[out]`,
  ].join(';');
}

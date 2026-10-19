/**
 * AI picture as a CARD on top of the host's video (not a full-window replacement, which read as a cut to another clip).
 * One window-sized RGBA overlay per picture: dimmed backdrop (the video stays visible around the card), soft shadow,
 * white border and a rounded picture. Built once per picture with ffmpeg; the render just fades it in and out.
 */
export interface CardWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Aspect of the generated pictures (1344x944). */
const IMAGE_ASPECT = 1344 / 944;
export const CARD = { widthShare: 0.778, topInset: 30, border: 6, radius: 26, dim: 0.38 } as const;

const even = (n: number) => Math.round(n / 2) * 2;

export function cardGeometry(win: CardWindow) {
  const cw = even(win.w * CARD.widthShare); // 840 for a 1080 window
  const ch = even(cw / IMAGE_ASPECT); // 590
  return { cw, ch, left: Math.round((win.w - cw) / 2), top: CARD.topInset };
}

/** ffmpeg filter_complex that turns input 0 (the picture) into the window-sized overlay → [out]. */
export function cardGraph(win: CardWindow): string {
  const { cw, ch, left, top } = cardGeometry(win);
  const b = CARD.border;
  const r = CARD.radius;
  const rr = (rad: number) => `255*lt(hypot(max(abs(X-W/2)-(W/2-${rad}),0),max(abs(Y-H/2)-(H/2-${rad}),0)),${rad})`;
  return [
    `[0:v]scale=${cw}:${ch}:force_original_aspect_ratio=increase:flags=lanczos,crop=${cw}:${ch},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${rr(r)}'[card]`,
    `color=c=white:s=${cw + 2 * b}x${ch + 2 * b},format=rgba,geq=r=255:g=255:b=255:a='${rr(r + b)}'[border]`,
    `color=c=black:s=${cw + 2 * b + 80}x${ch + 2 * b + 80},format=rgba,geq=r=0:g=0:b=0:a='140*lt(hypot(max(abs(X-W/2)-(W/2-80),0),max(abs(Y-H/2)-(H/2-80),0)),40)',gblur=sigma=14[shadow]`,
    `color=c=black@${CARD.dim}:s=${win.w}x${win.h},format=rgba[dim]`,
    `[dim][shadow]overlay=x=${left - b - 40}:y=${top - b - 40 + 10}:format=auto[s1]`,
    `[s1][border]overlay=x=${left - b}:y=${top - b}:format=auto[s2]`,
    `[s2][card]overlay=x=${left}:y=${top}:format=auto[out]`,
  ].join(';');
}

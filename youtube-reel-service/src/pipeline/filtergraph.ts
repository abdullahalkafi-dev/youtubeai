import type { ReelTemplate } from './template';

export interface RenderClipInput {
  /** Path or URL of the source video. */
  src: string;
  start: number;
  duration: number;
}

/** An AI image shown inside the video window from `start` to `end` (output seconds). */
export interface RenderImageInput {
  file: string;
  start: number;
  end: number;
}

export interface LoudnessMeasure {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
  target_offset: string;
}

export const LOUDNESS = { I: -14, TP: -1.5, LRA: 11 };
const FADE = 0.03;

function n(x: number) {
  return x.toFixed(3);
}

/** Input args for each clip: accurate seek + duration, with HTTP reconnect for MinIO URLs. */
export function clipInputArgs(clips: RenderClipInput[]): string[] {
  const args: string[] = [];
  for (const c of clips) {
    if (/^https?:/i.test(c.src)) args.push('-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
    args.push('-ss', n(c.start), '-t', n(c.duration), '-i', c.src);
  }
  return args;
}

function audioChain(i: number, d: number): string {
  const outStart = Math.max(0, d - FADE - 0.01);
  return (
    `[${i}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
    `afade=t=in:st=0:d=${FADE},afade=t=out:st=${n(outStart)}:d=${FADE}[a${i}]`
  );
}

/** Audio speed-up: chipmunk raises the pitch with the speed, natural keeps it. */
export function paceAudio(speed: number, voice: 'chipmunk' | 'natural'): string {
  if (!speed || Math.abs(speed - 1) < 1e-3) return '';
  return voice === 'chipmunk' ? `asetrate=${Math.round(48000 * speed)},aresample=48000,` : `atempo=${speed.toFixed(4)},`;
}

/** Pass 1: audio only, measure integrated loudness of the concatenated (and sped-up) clips. */
export function loudnessMeasureGraph(clips: RenderClipInput[], pace: { speed: number; voice: 'chipmunk' | 'natural' } = { speed: 1, voice: 'natural' }): string {
  const parts = clips.map((c, i) => audioChain(i, c.duration));
  const concatIn = clips.map((_, i) => `[a${i}]`).join('');
  parts.push(`${concatIn}concat=n=${clips.length}:v=0:a=1[ac]`);
  parts.push(`[ac]${paceAudio(pace.speed, pace.voice)}loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:print_format=json[aout]`);
  return parts.join(';');
}

/** Input args for still images (one per AI image beat), looped for their on-screen time. */
export function imageInputArgs(images: RenderImageInput[]): string[] {
  return images.flatMap((im) => ['-loop', '1', '-framerate', '30', '-t', n(im.end - im.start + 0.05), '-i', im.file]);
}

/**
 * Pass 2: full reel.
 *  - each clip: cover-fit + crop into the template window (gentle zoom of 16:9), 30 fps, yuv420p
 *  - concat, place on a black 1080x1920 base, overlay the PNG canvas (transparent window shows the video)
 *  - burn headline + word-highlight captions (ASS, bundled fonts)
 *  - loudness normalised with the pass-1 measurement (linear mode)
 */
export function renderGraph(input: {
  clips: RenderClipInput[];
  template: ReelTemplate;
  canvasInputIndex: number;
  assFile: string;
  fontsDir: string;
  measured: LoudnessMeasure | null;
  /** Output duration (after pace). */
  totalDuration: number;
  speed?: number;
  voice?: 'chipmunk' | 'natural';
  /** AI images; their inputs follow the canvas input. */
  images?: RenderImageInput[];
}): string {
  const { template: t, clips } = input;
  const { w, h, x, y } = t.window;
  const speed = input.speed && input.speed > 0 ? input.speed : 1;
  const parts: string[] = [];
  clips.forEach((c, i) => {
    parts.push(
      `[${i}:v]setpts=PTS-STARTPTS,fps=30,scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,` +
        `crop=${w}:${h}:(iw-${w})*${t.focusX}:(ih-${h})*${t.focusY},setsar=1,format=yuv420p[v${i}]`,
    );
    parts.push(audioChain(i, c.duration));
  });
  const concatIn = clips.map((_, i) => `[v${i}][a${i}]`).join('');
  parts.push(`${concatIn}concat=n=${clips.length}:v=1:a=1[vc0][ac0]`);
  if (Math.abs(speed - 1) < 1e-3) {
    parts.push('[vc0]null[vc]', '[ac0]anull[ac]');
  } else {
    parts.push(`[vc0]setpts=PTS/${speed.toFixed(4)},fps=30[vc]`);
    parts.push(`[ac0]${paceAudio(speed, input.voice ?? 'natural').replace(/,$/, '')}[ac]`);
  }
  parts.push(`color=c=black:s=${t.width}x${t.height}:r=30:d=${n(input.totalDuration + 0.5)}[bg]`);
  parts.push(`[bg][vc]overlay=x=${x}:y=${y}:shortest=1[b1]`);

  // AI images: cover the window, slow pan, short fades; under the canvas and captions.
  let cur = 'b1';
  (input.images ?? []).forEach((im, j) => {
    const idx = input.canvasInputIndex + 1 + j;
    const d = Math.max(0.3, im.end - im.start);
    const fade = Math.min(0.15, d / 4);
    const sw = Math.ceil((w * 1.12) / 2) * 2;
    const sh = Math.ceil((h * 1.12) / 2) * 2;
    parts.push(
      `[${idx}:v]scale=${sw}:${sh}:force_original_aspect_ratio=increase:flags=lanczos,` +
        `crop=${w}:${h}:x='(iw-ow)*min(1,t/${n(d)})':y='(ih-oh)/2',setsar=1,format=yuva420p,` +
        `fade=t=in:st=0:d=${n(fade)}:alpha=1,fade=t=out:st=${n(d - fade)}:d=${n(fade)}:alpha=1,` +
        `setpts=PTS-STARTPTS+${n(im.start)}/TB[im${j}]`,
    );
    parts.push(`[${cur}][im${j}]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${n(im.start)},${n(im.end)})'[bi${j}]`);
    cur = `bi${j}`;
  });

  parts.push(`[${cur}][${input.canvasInputIndex}:v]overlay=x=0:y=0:format=auto[b2]`);
  parts.push(`[b2]ass=${input.assFile}:fontsdir=${input.fontsDir},format=yuv420p[vout]`);
  const ln = input.measured
    ? `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:measured_I=${input.measured.input_i}:measured_TP=${input.measured.input_tp}` +
      `:measured_LRA=${input.measured.input_lra}:measured_thresh=${input.measured.input_thresh}:offset=${input.measured.target_offset}:linear=true`
    : `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`;
  // Explicit format after loudnorm: older ffmpeg (Debian 5.1) cannot negotiate the layout on its own.
  parts.push(`[ac]${ln},aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[aout]`);
  return parts.join(';');
}

/** Parse the JSON block loudnorm prints to stderr. */
export function parseLoudnorm(stderr: string): LoudnessMeasure | null {
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const j = JSON.parse(stderr.slice(start, end + 1));
    if (!j.input_i || j.input_i === '-inf') return null;
    return { input_i: j.input_i, input_tp: j.input_tp, input_lra: j.input_lra, input_thresh: j.input_thresh, target_offset: j.target_offset };
  } catch {
    return null;
  }
}

/** Parse ebur128 summary "I: -14.2 LUFS" and blackdetect events. */
export function parseQa(stderr: string): { lufs: number | null; blackSegments: number } {
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(stderr.slice(stderr.lastIndexOf('Summary:')));
  const black = (stderr.match(/black_start:/g) ?? []).length;
  return { lufs: m ? Number(m[1]) : null, blackSegments: black };
}

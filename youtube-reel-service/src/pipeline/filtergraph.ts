import type { ReelTemplate } from './template';
import type { Voice } from './timeline';
import { sfxChain, type EndSfx } from './sfx';

export interface RenderClipInput {
  /** Path or URL of the source video. */
  src: string;
  start: number;
  duration: number;
  /** Why this segment starts: the reel opening, a topic change (a new clip) or a pause jump cut inside a clip. */
  kind?: 'start' | 'join' | 'cut';
}

/** Visual rhythm. None of these changes a segment length, so captions, pictures and loudness stay in sync. */
export interface RenderFx {
  /** Alternate the framing 100% / 112% on every jump cut. */
  punch: boolean;
  /** White flash and a settling zoom where the topic changes. */
  join: boolean;
  /** Soft synthetic whoosh at the flashes (needs `join`). */
  whoosh: boolean;
  /** Thin progress line along the bottom of the video window. */
  bar: boolean;
}

export const NO_FX: RenderFx = { punch: false, join: false, whoosh: false, bar: false };
export const FX = { PUNCH_ZOOM: 1.12, SETTLE_FROM: 1.22, SETTLE_SEC: 0.22, FLASH_IN: 0.1, FLASH_OUT: 0.2, MIN_FLASH_AT: 3, BAR_HEIGHT: 10, WHOOSH_VOLUME: 0.7 };

/** Output-time start of every segment (segment durations are source seconds, so they are divided by the speed). */
export function segmentStarts(clips: RenderClipInput[], speed: number): number[] {
  let t = 0;
  return clips.map((c) => {
    const at = t / speed;
    t += c.duration;
    return at;
  });
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
    // atrim: exact length, so many short segments (pause cuts) can't add up to drift.
    `[${i}:a]asetpts=PTS-STARTPTS,aresample=48000,atrim=duration=${n(d)},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
    `afade=t=in:st=0:d=${FADE},afade=t=out:st=${n(outStart)}:d=${FADE}[a${i}]`
  );
}

/**
 * Audio speed-up (returns a filter prefix ending in a comma, or '').
 *  - energetic: rubberband tempo + a small pitch raise with formants PRESERVED, so the voice keeps its character
 *    (measured on the host: speed 1.15, pitch +9%, voice brightness unchanged)
 *  - chipmunk: asetrate resample: pitch and voice character both rise (+17% pitch, +18% brightness at 1.2x)
 *  - natural: tempo only
 */
export function paceAudio(speed: number, voice: Voice, semitones = 0): string {
  if (!speed || Math.abs(speed - 1) < 1e-3) return '';
  if (voice === 'chipmunk') return `asetrate=${Math.round(48000 * speed)},aresample=48000,`;
  if (voice === 'energetic') return `rubberband=tempo=${speed.toFixed(4)}:pitch=${Math.pow(2, semitones / 12).toFixed(4)}:formant=preserved:pitchq=quality,`;
  return `atempo=${speed.toFixed(4)},`;
}

/** Pass 1: audio only, measure integrated loudness of the concatenated (and sped-up) clips. */
export function loudnessMeasureGraph(clips: RenderClipInput[], pace: { speed: number; voice: Voice; semitones?: number } = { speed: 1, voice: 'natural' }): string {
  const parts = clips.map((c, i) => audioChain(i, c.duration));
  const concatIn = clips.map((_, i) => `[a${i}]`).join('');
  parts.push(`${concatIn}concat=n=${clips.length}:v=0:a=1[ac]`);
  parts.push(`[ac]${paceAudio(pace.speed, pace.voice, pace.semitones ?? 0)}loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:print_format=json[aout]`);
  return parts.join(';');
}

/** The planned reel audio on its own (clips back to back, no cuts, no speed-up), mono 16 kHz, for measuring word times. */
export function plannedAudioGraph(clips: RenderClipInput[]): string {
  const parts = clips.map((c, i) => audioChain(i, c.duration));
  const concatIn = clips.map((_, i) => `[a${i}]`).join('');
  parts.push(`${concatIn}concat=n=${clips.length}:v=0:a=1[ac]`);
  parts.push('[ac]aresample=16000,aformat=sample_fmts=fltp:channel_layouts=mono[aout]');
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
  voice?: Voice;
  semitones?: number;
  /** AI images; their inputs follow the canvas input. */
  images?: RenderImageInput[];
  fx?: RenderFx;
  /** Ending sound: a tail is added after the last word and the sound plays in it. */
  sfx?: (EndSfx & { volume: number }) | null;
}): string {
  const { template: t, clips } = input;
  const { w, h, x, y } = t.window;
  const speed = input.speed && input.speed > 0 ? input.speed : 1;
  const fx = input.fx ?? NO_FX;
  const tail = input.sfx ? input.sfx.tail : 0;
  const dur = input.totalDuration + tail;
  const starts = segmentStarts(clips, speed);
  const even = (v: number) => Math.round(v / 2) * 2;
  const parts: string[] = [];
  const flashAt: number[] = [];
  let zoomOdd = false;
  clips.forEach((c, i) => {
    // Framing: a topic change or the opening resets to 100%; every jump cut alternates 100% / 112%.
    if (c.kind === 'cut') zoomOdd = !zoomOdd;
    else zoomOdd = false;
    const zoom = fx.punch && zoomOdd ? FX.PUNCH_ZOOM : 1;
    const settle = fx.join && c.kind === 'join';
    if (settle && fx.join && starts[i] >= FX.MIN_FLASH_AT) flashAt.push(starts[i]);
    // The settle runs in output seconds; the segment clock is in source seconds (until the speed-up).
    const k = `(${zoom}+${(FX.SETTLE_FROM - zoom).toFixed(3)}*max(0,1-t/${n(FX.SETTLE_SEC * speed)}))`;
    const fit = settle
      ? `scale=w='trunc(iw*max(${w}/iw,${h}/ih)*${k}/2)*2':h='trunc(ih*max(${w}/iw,${h}/ih)*${k}/2)*2':eval=frame:flags=bicubic`
      : zoom === 1
        ? `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos`
        : `scale=${even(w * zoom)}:${even(h * zoom)}:force_original_aspect_ratio=increase:flags=lanczos`;
    parts.push(
      `[${i}:v]setpts=PTS-STARTPTS,fps=30,trim=duration=${n(c.duration)},setpts=PTS-STARTPTS,${fit},` +
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
    parts.push(`[ac0]${paceAudio(speed, input.voice ?? 'natural', input.semitones ?? 0).replace(/,$/, '')}[ac]`);
  }
  // The last picture holds while the ending sound plays.
  let video = 'vc';
  if (tail > 0) {
    parts.push(`[vc]tpad=stop_mode=clone:stop_duration=${n(tail)}[vct]`);
    video = 'vct';
  }
  parts.push(`color=c=black:s=${t.width}x${t.height}:r=30:d=${n(dur + 0.5)}[bg]`);
  parts.push(`[bg][${video}]overlay=x=${x}:y=${y}:shortest=1[b1]`);

  // AI pictures: each input is a window-sized card overlay (card.ts: dimmed backdrop + shadow + border + rounded picture),
  // faded in/out, under the canvas and captions so the host's video stays visible around the card.
  let cur = 'b1';
  (input.images ?? []).forEach((im, j) => {
    const idx = input.canvasInputIndex + 1 + j;
    const d = Math.max(0.4, im.end - im.start);
    const fin = 0.18;
    const fout = 0.12;
    parts.push(
      `[${idx}:v]format=yuva420p,fade=t=in:st=0:d=${n(fin)}:alpha=1,fade=t=out:st=${n(Math.max(fin, d - fout))}:d=${n(fout)}:alpha=1,` +
        `setpts=PTS-STARTPTS+${n(im.start)}/TB[im${j}]`,
    );
    parts.push(`[${cur}][im${j}]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${n(im.start)},${n(im.end)})'[bi${j}]`);
    cur = `bi${j}`;
  });

  // Topic-change flash and progress line sit inside the window, above the pictures, under the canvas and captions.
  flashAt.forEach((at, j) => {
    const a = Math.max(0, at - FX.FLASH_IN);
    const b = at + FX.FLASH_OUT;
    parts.push(
      `color=c=white:s=${w}x${h}:r=30:d=${n(dur + 0.5)},format=yuva420p,fade=t=in:st=${n(a)}:d=${n(FX.FLASH_IN)}:alpha=1,fade=t=out:st=${n(at)}:d=${n(FX.FLASH_OUT)}:alpha=1[fl${j}]`,
    );
    parts.push(`[${cur}][fl${j}]overlay=x=${x}:y=${y}:shortest=1:enable='between(t,${n(a)},${n(b)})'[bf${j}]`);
    cur = `bf${j}`;
  });
  if (fx.bar) {
    parts.push(`color=c=0xFFD400:s=${w}x${FX.BAR_HEIGHT}:r=30:d=${n(dur + 0.5)}[bar]`);
    parts.push(`[${cur}][bar]overlay=x='-w+W*${tail > 0 ? `min(t,${n(input.totalDuration)})` : 't'}/${n(input.totalDuration)}':y=${y + h - FX.BAR_HEIGHT}:shortest=1[bbar]`);
    cur = 'bbar';
  }

  parts.push(`[${cur}][${input.canvasInputIndex}:v]overlay=x=0:y=0:format=auto[b2]`);
  parts.push(`[b2]ass=${input.assFile}:fontsdir=${input.fontsDir},format=yuv420p[vout]`);
  const ln = input.measured
    ? `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:measured_I=${input.measured.input_i}:measured_TP=${input.measured.input_tp}` +
      `:measured_LRA=${input.measured.input_lra}:measured_thresh=${input.measured.input_thresh}:offset=${input.measured.target_offset}:linear=true`
    : `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`;
  // Explicit format after loudnorm: older ffmpeg (Debian 5.1) cannot negotiate the layout on its own.
  const fmt = `aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`;
  const whooshes = fx.whoosh && flashAt.length > 0;
  if (whooshes || input.sfx) {
    // Synthetic whoosh (filtered noise, no licensed audio) at each flash, mixed AFTER loudnorm so the voice level and the
    // measured loudness are untouched; the limiter only guards the sum. The ending sound joins the same mix.
    parts.push(`[ac]${ln},${fmt}${tail > 0 ? `,apad=pad_dur=${n(tail)}` : ''}[avo]`);
    const mix = ['[avo]'];
    if (input.sfx) {
      parts.push(sfxChain(input.sfx.kind, input.totalDuration + 0.04, input.sfx.volume, 'sfx'));
      mix.push('[sfx]');
    }
    (whooshes ? flashAt : []).forEach((at, j) => {
      const ms = Math.max(0, Math.round((at - 0.3) * 1000));
      parts.push(
        `anoisesrc=d=0.5:c=pink:a=0.6:r=48000,highpass=f=500,lowpass=f=7000,afade=t=in:d=0.28,afade=t=out:st=0.28:d=0.22,volume=${FX.WHOOSH_VOLUME},adelay=${ms}|${ms},aformat=sample_fmts=fltp:channel_layouts=stereo[wh${j}]`,
      );
      mix.push(`[wh${j}]`);
    });
    parts.push(`${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=first,alimiter=limit=0.84:level=disabled:latency=1,${fmt}[aout]`);
  } else {
    parts.push(`[ac]${ln},${fmt}[aout]`);
  }
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

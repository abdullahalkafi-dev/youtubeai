/**
 * Ending sound effect for a reel (client request: end the Shorts with a car screech or similar).
 *
 * Every sound is generated inside the render from a formula (no recordings, no downloaded files), so there is
 * nothing to license and nothing that can trigger a copyright claim, the same way the topic-change whoosh works.
 * The sound plays in a short tail added after the last word, so it is never talked over.
 */

export type SfxKind = 'screech' | 'slam' | 'gavel' | 'boom' | 'scratch';

export interface EndSfx {
  kind: SfxKind;
  /** Seconds added after the last word (the last picture holds while the sound plays). */
  tail: number;
}

export const SFX_KINDS: SfxKind[] = ['screech', 'slam', 'gavel', 'boom', 'scratch'];

const TAIL: Record<SfxKind, number> = { screech: 1.0, slam: 0.8, gavel: 0.7, boom: 1.0, scratch: 0.6 };

// Each sound is one aevalsrc expression (t = seconds since the start of the sound).
const EXPR: Record<SfxKind, { expr: string; dur: number; post: string }> = {
  // Tyre screech: a rising squeal with harmonics, a fast wobble and a rasp of noise.
  screech: {
    expr: "(1+0.3*sin(2*PI*37*t))*min(1,t*30)*min(1,(0.95-t)*8)*(0.45*sin(2*PI*(1250*t+260*t*t))+0.25*sin(2*PI*(2500*t+520*t*t))+0.12*sin(2*PI*(3750*t+780*t*t))+0.22*(random(0)-0.5))",
    dur: 1.0,
    post: 'highpass=f=650,lowpass=f=7000',
  },
  // Cell door slam: a low thud, a burst of noise and two metallic ringing tones.
  slam: {
    expr: '0.9*sin(2*PI*68*t)*exp(-10*t)+0.55*(random(0)-0.5)*exp(-38*t)+0.22*sin(2*PI*1150*t)*exp(-8*t)+0.16*sin(2*PI*1730*t)*exp(-11*t)',
    dur: 0.8,
    post: 'lowpass=f=9000',
  },
  // Two gavel knocks.
  gavel: {
    expr: 'lt(t,0.24)*(0.75*sin(2*PI*410*t)+0.5*(random(0)-0.5))*exp(-48*t)+gte(t,0.24)*(0.75*sin(2*PI*410*(t-0.24))+0.5*(random(0)-0.5))*exp(-48*(t-0.24))',
    dur: 0.7,
    post: 'lowpass=f=8000',
  },
  // A deep, falling hit that rings out.
  boom: {
    expr: '0.95*sin(2*PI*(52*t-9*t*t))*exp(-3.4*t)+0.3*(random(0)-0.5)*exp(-14*t)',
    dur: 1.0,
    post: 'lowpass=f=1200',
  },
  // Record scratch: a falling squeal over noise.
  scratch: {
    expr: 'min(1,t*40)*min(1,(0.5-t)*10)*(0.5*sin(2*PI*(2400*t-3600*t*t))+0.3*(random(0)-0.5))',
    dur: 0.5,
    post: 'highpass=f=400,lowpass=f=7500',
  },
};

/** The filter chain that makes the sound, delayed to start at `atSec` (output seconds), ending in `[label]`. */
export function sfxChain(kind: SfxKind, atSec: number, volume: number, label: string): string {
  const s = EXPR[kind];
  const ms = Math.max(0, Math.round(atSec * 1000));
  return (
    `aevalsrc='${s.expr}':d=${s.dur}:s=48000:c=mono,${s.post},` +
    `afade=t=in:d=0.004,afade=t=out:st=${(s.dur - 0.08).toFixed(3)}:d=0.08,volume=${volume.toFixed(3)},` +
    `aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${ms}|${ms}[${label}]`
  );
}

const RULES: Array<{ kind: SfxKind; words: RegExp }> = [
  { kind: 'screech', words: /\b(car|cars|driv\w*|road|highway|crash\w*|chase|chased|speed\w*|escape\w*|fled|flee|getaway|tire|vehicle|motorcycle)\b/ },
  { kind: 'gavel', words: /\b(trial|court\w*|judge|jury|verdict|sentenc\w*|guilty|convict\w*|plea|prosecut\w*|testimony|testif\w*|indict\w*|lawyer|attorney)\b/ },
  { kind: 'slam', words: /\b(prison|jail|cell|inmate|locked|lock|bars|solitary|parole|life without|behind bars|incarcerat\w*|lockdown)\b/ },
  { kind: 'scratch', words: /\b(snitch\w*|lied|lie|lies|betray\w*|fake|twist|exposed|caught|plot|setup|set up|rat)\b/ },
  { kind: 'boom', words: /\b(kill\w*|murder\w*|dead|death|died|shot|shoot\w*|blood|grave|funeral)\b/ },
];

/**
 * Picks the sound that fits what the reel is about. The first matching rule wins, in the order above
 * (a car or road beats a courtroom word, which beats a prison word). With no match the deep hit is used,
 * the safest ending for a serious topic.
 */
export function pickSfx(...texts: Array<string | string[] | undefined | null>): SfxKind {
  const text = texts
    .flatMap((t) => (Array.isArray(t) ? t : [t]))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  for (const r of RULES) if (r.words.test(text)) return r.kind;
  return 'boom';
}

export function endSfxFor(kind: SfxKind): EndSfx {
  return { kind, tail: TAIL[kind] };
}

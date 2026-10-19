import { buildTimeline, mapWords, NO_PACE, PaceOptions } from './timeline';
import { renderGraph, loudnessMeasureGraph } from './filtergraph';
import { parseTemplate } from './template';

const pace: PaceOptions = { speed: 1.2, voice: 'chipmunk', semitones: 0, minGap: 0.35, keep: 0.08, maxSegments: 30 };
const w = (t: string, s: number, e: number) => ({ w: t, s, e });

describe('timeline (pause cuts + speed)', () => {
  // Two clips: 10s from video A at 100s, 5s from video B at 40s. One long pause in clip 1 (3.0→4.5).
  const clips = [
    { src: 'a.mp4', start: 100, duration: 10 },
    { src: 'b.mp4', start: 40, duration: 5 },
  ];
  const words = [w('one', 0.2, 1.0), w('two', 1.1, 3.0), w('three', 4.5, 9.8), w('four', 10.1, 14.9)];

  it('without pace it is the identity', () => {
    const tl = buildTimeline(clips, words, NO_PACE);
    expect(tl.cuts).toEqual([]);
    expect(tl.segments).toEqual(clips);
    expect(tl.duration).toBe(15);
    expect(tl.map(7.3)).toBeCloseTo(7.3);
  });

  it('cuts pauses inside a clip, keeps a little air, and never cuts across clips', () => {
    const tl = buildTimeline(clips, words, pace);
    // the cut start moves by at most half a frame so the kept segment is whole frames (92 frames = 3.0667 s)
    expect(tl.cuts).toEqual([[3.067, 4.42], [9.987, 10]]);
    expect(tl.segments).toEqual([
      { src: 'a.mp4', start: 100, duration: 3.067 },
      { src: 'a.mp4', start: 104.42, duration: 5.567 }, // 167 frames; the last 0.013 s is the cut above
      { src: 'b.mp4', start: 40, duration: 5 },
    ]);
    expect(tl.duration).toBeCloseTo((3.067 + 5.567 + 5) / 1.2, 2);
  });

  it('every kept segment is a whole number of frames, so a reel with many cuts cannot drift', () => {
    const many = Array.from({ length: 36 }, (_, i) => w(`w${i}`, i * 1.1, i * 1.1 + 0.45));
    const tl = buildTimeline([{ src: 'x', start: 0, duration: 21 }, { src: 'x', start: 21, duration: 19 }], many, { ...pace, maxSegments: 30 });
    for (const sg of tl.segments) expect(Math.abs(sg.duration * 30 - Math.round(sg.duration * 30))).toBeLessThan(0.02);
    // the file length is exactly what map() says for the end of the reel
    expect(tl.map(40)).toBeCloseTo(tl.duration, 2);
    // words after many cuts stay within one frame of where the audio really is
    expect(tl.cuts.length).toBeGreaterThan(20);
  });

  it('maps words so captions follow the cut and the speed', () => {
    const tl = buildTimeline(clips, words, pace);
    const out = mapWords(words, tl);
    expect(out[0].s).toBeCloseTo(0.2 / 1.2, 3);
    expect(out[2].s).toBeCloseTo((4.5 - 1.353) / 1.2, 2); // after the cut (1.353 s removed incl. frame rounding)
    expect(out[3].e).toBeCloseTo((14.9 - 1.366) / 1.2, 2);
    // a time inside the removed pause lands exactly on the cut point
    expect(tl.map(3.7)).toBeCloseTo(3.067 / 1.2, 2);
    // the last word ends inside the file
    expect(out[3].e).toBeLessThanOrEqual(tl.duration + 1e-6);
  });

  it('respects the segment budget by cutting only the longest pauses', () => {
    const many = Array.from({ length: 12 }, (_, i) => w(`w${i}`, i * 1.0, i * 1.0 + 0.4 + (i % 2) * 0.1));
    const tl = buildTimeline([{ src: 'x', start: 0, duration: 12 }], many, { ...pace, maxSegments: 4 });
    expect(tl.segments.length).toBe(4);
    expect(tl.cuts.filter(([a, b]) => b - a > 0.1).length).toBe(3); // the 3 longest pauses
  });
});

describe('render graph pace + images', () => {
  const template = parseTemplate({ window: { x: 0, y: 656, w: 1080, h: 608 }, headline: {}, captions: {} });
  it('speeds video and raises pitch for chipmunk', () => {
    const g = renderGraph({ clips: [{ src: 'a', start: 0, duration: 5 }], template, canvasInputIndex: 1, assFile: 'r.ass', fontsDir: 'f', measured: null, totalDuration: 4.17, speed: 1.2, voice: 'chipmunk' });
    expect(g).toContain('[vc0]setpts=PTS/1.2000,fps=30[vc]');
    expect(g).toContain('[ac0]asetrate=57600,aresample=48000[ac]');
    expect(loudnessMeasureGraph([{ src: 'a', start: 0, duration: 5 }], { speed: 1.2, voice: 'chipmunk' })).toContain('asetrate=57600,aresample=48000,loudnorm');
  });
  it('energetic voice: rubberband with formants preserved (same voice, a little higher and faster)', () => {
    const g = renderGraph({ clips: [{ src: 'a', start: 0, duration: 5 }], template, canvasInputIndex: 1, assFile: 'r.ass', fontsDir: 'f', measured: null, totalDuration: 4.35, speed: 1.15, voice: 'energetic', semitones: 1.5 });
    expect(g).toContain('[ac0]rubberband=tempo=1.1500:pitch=1.0905:formant=preserved:pitchq=quality[ac]');
    expect(loudnessMeasureGraph([{ src: 'a', start: 0, duration: 5 }], { speed: 1.15, voice: 'energetic', semitones: 1.5 })).toContain('rubberband=tempo=1.1500:pitch=1.0905:formant=preserved:pitchq=quality,loudnorm');
  });
  it('natural voice uses atempo; speed 1 is a pass-through', () => {
    expect(renderGraph({ clips: [{ src: 'a', start: 0, duration: 5 }], template, canvasInputIndex: 1, assFile: 'r.ass', fontsDir: 'f', measured: null, totalDuration: 4, speed: 1.2, voice: 'natural' })).toContain('atempo=1.2000');
    expect(renderGraph({ clips: [{ src: 'a', start: 0, duration: 5 }], template, canvasInputIndex: 1, assFile: 'r.ass', fontsDir: 'f', measured: null, totalDuration: 5 })).toContain('[vc0]null[vc]');
  });
  it('overlays images inside the window, under the canvas, only during their beat', () => {
    const g = renderGraph({
      clips: [{ src: 'a', start: 0, duration: 10 }],
      template,
      canvasInputIndex: 1,
      assFile: 'r.ass',
      fontsDir: 'f',
      measured: null,
      totalDuration: 10,
      images: [{ file: 'i.jpg', start: 2, end: 4.5 }],
    });
    expect(g).toContain("[2:v]scale=1210:682");
    expect(g).toContain("[b1][im0]overlay=x=0:y=656:eof_action=pass:enable='between(t,2.000,4.500)'[bi0]");
    expect(g).toContain('[bi0][1:v]overlay=x=0:y=0');
  });
});

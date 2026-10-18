import { buildTimeline, mapWords, NO_PACE, PaceOptions } from './timeline';
import { renderGraph, loudnessMeasureGraph } from './filtergraph';
import { parseTemplate } from './template';

const pace: PaceOptions = { speed: 1.2, voice: 'chipmunk', minGap: 0.35, keep: 0.08, maxSegments: 30 };
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
    expect(tl.cuts).toEqual([[3.08, 4.42]]); // 9.8→10.1 crosses the clip boundary: untouched
    expect(tl.segments).toEqual([
      { src: 'a.mp4', start: 100, duration: 3.08 },
      { src: 'a.mp4', start: 104.42, duration: 5.58 },
      { src: 'b.mp4', start: 40, duration: 5 },
    ]);
    // 15s planned − 1.34s cut = 13.66s, at 1.2x
    expect(tl.duration).toBeCloseTo(13.66 / 1.2, 2);
  });

  it('maps words so captions follow the cut and the speed', () => {
    const tl = buildTimeline(clips, words, pace);
    const out = mapWords(words, tl);
    expect(out[0].s).toBeCloseTo(0.2 / 1.2, 3);
    expect(out[2].s).toBeCloseTo((4.5 - 1.34) / 1.2, 3); // after the cut
    expect(out[3].e).toBeCloseTo((14.9 - 1.34) / 1.2, 3);
    // a time inside the removed pause lands exactly on the cut point
    expect(tl.map(3.7)).toBeCloseTo(3.08 / 1.2, 3);
    // the last word ends inside the file
    expect(out[3].e).toBeLessThanOrEqual(tl.duration + 1e-6);
  });

  it('respects the segment budget by cutting only the longest pauses', () => {
    const many = Array.from({ length: 12 }, (_, i) => w(`w${i}`, i * 1.0, i * 1.0 + 0.4 + (i % 2) * 0.1));
    const tl = buildTimeline([{ src: 'x', start: 0, duration: 12 }], many, { ...pace, maxSegments: 4 });
    expect(tl.cuts.length).toBe(3);
    expect(tl.segments.length).toBe(4);
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

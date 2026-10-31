import { boxesFor, Box, checkSample, coverCrop, decideShot, iou, LayoutSample, lookTimes, mergeShots, parseCutTimes, RawFrameLayout, shotsFromCuts, typicalBoxes } from './layout';
import { buildFullscreenAss, fullscreenSegmentChain, HOST_H, HOST_Y } from './fullscreen';
import { renderGraph } from './filtergraph';
import { buildTimeline } from './timeline';
import type { ReelTemplate } from './template';

const W = 1920;
const H = 1080;
const frac = (b: Box) => ({ x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H });
// the boxes set by hand for the Diddy sample (host left, picture right)
const HOST_L: Box = { x: 0, y: 60, w: 700, h: 790 };
const PIC_R: Box = { x: 690, y: 112, w: 1170, h: 698 };
const raw = (over: Partial<RawFrameLayout> = {}): RawFrameLayout => ({ kind: 'host_left', confidence: 0.9, host: frac(HOST_L), picture: frac(PIC_R), ...over });

describe('checkSample', () => {
  it('keeps a plausible host-left frame and converts the boxes to pixels', () => {
    const s = checkSample(raw(), 12, W, H, 0.7);
    expect(s.kind).toBe('host_left');
    expect(iou(s.host!, HOST_L)).toBeGreaterThan(0.99);
    expect(iou(s.picture!, PIC_R)).toBeGreaterThan(0.99);
  });

  it('never lets a box reach the phone-number ticker at the bottom', () => {
    const s = checkSample(raw({ host: { x: 0, y: 0.05, w: 0.36, h: 0.95 } }), 1, W, H, 0.7);
    expect(s.kind).toBe('host_left');
    expect(s.host!.y + s.host!.h).toBeLessThanOrEqual(Math.round(H * 0.82));
  });

  it('rejects geometry that cannot be the studio set', () => {
    expect(checkSample(raw({ kind: 'host_right' }), 1, W, H, 0.7).kind).toBe('other'); // says right, boxes say left
    expect(checkSample(raw({ host: { x: 0, y: 0.1, w: 0.1, h: 0.7 } }), 1, W, H, 0.7).kind).toBe('other'); // host far too narrow
    expect(checkSample(raw({ picture: { x: 0.2, y: 0.1, w: 0.7, h: 0.7 } }), 1, W, H, 0.7).kind).toBe('other'); // overlaps the host
    expect(checkSample(raw({ host: null }), 1, W, H, 0.7).kind).toBe('other');
  });

  it('treats an unsure answer as other', () => {
    expect(checkSample(raw({ confidence: 0.5 }), 1, W, H, 0.7).kind).toBe('other');
    expect(checkSample(raw({ kind: 'other', host: null, picture: null }), 1, W, H, 0.7).kind).toBe('other');
  });
});

describe('typical boxes', () => {
  const sample = (t: number, host: Box, picture: Box, kind: LayoutSample['kind'] = 'host_left'): LayoutSample => ({ t, kind, conf: 0.9, host, picture });
  it('needs two confident samples, then uses the median', () => {
    const one = [sample(1, HOST_L, PIC_R)];
    expect(typicalBoxes(one, 'host_left')).toBeNull();
    const many = [sample(1, HOST_L, PIC_R), sample(2, { ...HOST_L, x: 10 }, { ...PIC_R, y: 120 }), sample(3, { ...HOST_L, x: 4 }, { ...PIC_R, y: 116 })];
    expect(typicalBoxes(many, 'host_left')).toEqual({ host: { ...HOST_L, x: 4 }, picture: { ...PIC_R, y: 116 } });
    expect(typicalBoxes(many, 'host_right')).toBeNull();
  });

  it('a sample that agrees with the video uses the typical boxes, one that does not keeps its own', () => {
    const base = [sample(1, HOST_L, PIC_R), sample(2, { ...HOST_L, x: 6 }, PIC_R), sample(3, HOST_L, { ...PIC_R, y: 114 })];
    const near = sample(4, { ...HOST_L, x: 8 }, PIC_R);
    expect(boxesFor(near, [...base, near])!.host).toEqual(typicalBoxes([...base, near], 'host_left')!.host);
    const zoomed = sample(5, { x: 0, y: 200, w: 560, h: 600 }, PIC_R);
    expect(boxesFor(zoomed, [...base, zoomed])!.host).toEqual(zoomed.host);
    expect(boxesFor({ t: 1, kind: 'other', conf: 0 }, base)).toBeNull();
  });
});

describe('shots', () => {
  it('splits a window at the cuts and ignores cuts that are too close to each other or to the ends', () => {
    expect(shotsFromCuts(30, [10.2, 10.5, 20])).toEqual([[0, 10.2], [10.2, 20], [20, 30]]);
    expect(shotsFromCuts(30, [0.3, 29.8])).toEqual([[0, 30]]);
    expect(shotsFromCuts(12, [])).toEqual([[0, 12]]);
  });

  it('reads cut times from ffmpeg showinfo output', () => {
    const err = '[Parsed_showinfo_2 @ 0x1] n:   0 pts:  9000 pts_time:10.2     pos: 1\n[Parsed_showinfo_2 @ 0x1] n: 1 pts: 18000 pts_time:20 pos: 2\n';
    expect(parseCutTimes(err)).toEqual([10.2, 20]);
  });

  it('looks once in a short shot and twice in a long one', () => {
    expect(lookTimes(0, 2)).toEqual([1]);
    expect(lookTimes(10, 30)).toEqual([15, 25]);
  });

  it('a shot is usable only when every look agrees on the studio set-up', () => {
    const l = (kind: LayoutSample['kind']): LayoutSample => ({ t: 1, kind, conf: 0.9, host: HOST_L, picture: PIC_R });
    expect(decideShot([l('host_left'), l('host_left')]).ok).toBe(true);
    expect(decideShot([l('host_left'), l('host_right')]).ok).toBe(false);
    expect(decideShot([l('host_left'), l('other')]).ok).toBe(false);
    expect(decideShot([]).ok).toBe(false);
  });

  it('joins neighbouring shots that crop the same way and keeps a real change apart', () => {
    const s = (from: number, to: number, kind: 'host_left' | 'host_right', host: Box, picture: Box) => ({ from, to, kind, host, picture });
    const merged = mergeShots([s(0, 5, 'host_left', HOST_L, PIC_R), s(5, 9, 'host_left', HOST_L, PIC_R), s(9, 14, 'host_right', { x: 1030, y: 100, w: 870, h: 750 }, { x: 15, y: 140, w: 1075, h: 705 })]);
    expect(merged.map((m) => [m.from, m.to, m.kind])).toEqual([[0, 9, 'host_left'], [9, 14, 'host_right']]);
  });
});

describe('coverCrop', () => {
  it('trims the longer side around the centre so the block is filled without stretching', () => {
    const c = coverCrop(PIC_R, 1080 / 680);
    expect(c.w / c.h).toBeCloseTo(1080 / 680, 1);
    expect(c.w).toBeLessThanOrEqual(PIC_R.w);
    expect(c.h).toBeLessThanOrEqual(PIC_R.h);
    expect(c.x + c.w / 2).toBeCloseTo(PIC_R.x + PIC_R.w / 2, 0);
    expect(c.w % 2 === 0 && c.h % 2 === 0).toBe(true);
  });
});

describe('full-screen render', () => {
  const layout = { from: 0, to: 10, kind: 'host_left' as const, host: HOST_L, picture: PIC_R };
  const template = { width: 1080, height: 1920, window: { x: 0, y: 480, w: 1080, h: 890 }, focusX: 0.5, focusY: 0.4 } as unknown as ReelTemplate;

  it('builds one 1080x1920 frame per segment from the host and picture crops', () => {
    const g = fullscreenSegmentChain(0, 10, layout);
    expect(g).toContain('[0:v]setpts=PTS-STARTPTS,fps=30,trim=duration=10.000');
    expect(g).toContain(`overlay=0:${HOST_Y}`);
    expect(g).toContain(`scale=${Math.round((HOST_L.w * HOST_H) / HOST_L.h / 2) * 2}:${HOST_H}`);
    expect(g).toContain('[v0]');
    expect(HOST_Y + HOST_H).toBe(1920);
  });

  it('puts the segments straight into the output with captions on top, no template canvas', () => {
    const clips = [
      { src: 'a', start: 0, duration: 6, layout },
      { src: 'a', start: 6, duration: 4, layout: { ...layout, kind: 'host_right' as const, host: { x: 1030, y: 100, w: 870, h: 750 }, picture: { x: 15, y: 140, w: 1075, h: 705 } } },
    ];
    const g = renderGraph({ clips, template, canvasInputIndex: 2, assFile: 'r.ass', fontsDir: 'f', measured: null, totalDuration: 10, look: 'fullscreen' });
    expect(g).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1');
    expect(g).toContain('ass=r.ass:fontsdir=f,format=yuv420p[vout]');
    expect(g).not.toContain('[b1]');
    expect(g).not.toContain('2:v]'); // the canvas input is never read
  });

  it('refuses a full-screen clip without a layout', () => {
    expect(() => renderGraph({ clips: [{ src: 'a', start: 0, duration: 6 }], template, canvasInputIndex: 1, assFile: 'r.ass', fontsDir: 'f', measured: null, totalDuration: 6, look: 'fullscreen' })).toThrow('layout');
  });

  it('the timeline keeps each clip layout on its segments', () => {
    const tl = buildTimeline([{ src: 'a', start: 0, duration: 6, layout }], [], { speed: 1, voice: 'natural', semitones: 0, minGap: 0, keep: 0, maxSegments: 30 });
    expect(tl.segments[0].layout).toBe(layout);
  });

  it('captions, two-line headline with the second line yellow, and the first-comment line', () => {
    const ass = buildFullscreenAss({ words: [{ w: 'hello', s: 0, e: 0.5, eos: true }], headline: "Diddy's money can't open that steel door", duration: 10 });
    expect(ass).toContain('FULL VIDEO LINK IN FIRST COMMENT');
    expect(ass).not.toContain('CHECK DESCRIPTION');
    expect(ass).toContain('BOOK A CALL  1-917-680-9091');
    expect(ass).toMatch(/Head,,0,0,0,,\{\\an8\\pos\(540,52\)\\fs\d+\}[^\n]*\\N\{\\c&H0000D4FF\}[^\n]*/);
    expect(ass).toContain('Dialogue: 1,');
  });
});

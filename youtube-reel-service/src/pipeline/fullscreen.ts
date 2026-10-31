import type { ReelWord } from '../db/schemas/reel.schema';
import { assColor, buildAss, layoutHeadline } from './captions';
import { coverCrop, ShotLayout } from './layout';
import type { ReelTemplate } from './template';

/**
 * The full-screen reel look (client-approved 2026-10-31): headline on top, the story picture cropped from the studio frame,
 * the host cropped big at the bottom over a blurred fill, captions over the host, a gold line between the blocks, and the
 * "full video" line plus the phone line at the very bottom. The crop boxes come from the studio layout of each shot (layout.ts).
 *
 * Geometry (1080x1920):  headline 52..390 | picture 390..1070 | gold line | host 1070..1920 | text strip 1818..1902
 */
export const FS = {
  W: 1080,
  H: 1920,
  headTop: 52,
  picY: 390,
  picH: 680,
  line: 6,
  tagY: 1846,
  phoneY: 1880,
  stripY: 1818,
  stripH: 84,
  gold: '0xFFD400',
  tag: 'FULL VIDEO LINK IN FIRST COMMENT',
  phone: 'BOOK A CALL  1-917-680-9091',
} as const;

export const HOST_Y = FS.picY + FS.picH;
export const HOST_H = FS.H - HOST_Y;

/** Captions and headline settings for this look (the same schema the classic template uses, so the caption code is shared). */
export const FULLSCREEN_TEMPLATE: ReelTemplate = {
  name: 'fullscreen',
  width: FS.W,
  height: FS.H,
  canvas: '',
  window: { x: 0, y: 0, w: FS.W, h: FS.H },
  focusX: 0.5,
  focusY: 0.5,
  headline: { enabled: false, font: 'Anton', size: 140, minSize: 100, charWidth: 0.27, color: '#FFFFFF', accentColor: '#FFD400', outlineColor: '#000000', outline: 5, centerX: 540, top: FS.headTop, maxWidth: 1000, maxLines: 2, uppercase: true },
  captions: { enabled: true, font: 'Montserrat ExtraBold', size: 84, color: '#FFFFFF', highlightColor: '#FFD400', outlineColor: '#000000', outline: 7, shadow: 2, centerX: 540, centerY: 1250, maxWordsPerChunk: 3, maxCharsPerChunk: 16, uppercase: true },
};

function assTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const cs = Math.round((s - m * 60) * 100);
  return `0:${String(m).padStart(2, '0')}:${String(Math.floor(cs / 100)).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

/** Captions (shared code) + the two-line headline (second line yellow) + the bottom text, as one ASS file. `duration` includes any ending-sound tail. */
export function buildFullscreenAss(input: { words: ReelWord[]; headline: string | null; duration: number }): string {
  let ass = buildAss({ words: input.words, headline: null, template: FULLSCREEN_TEMPLATE, duration: input.duration });
  const white = assColor('#FFFFFF');
  const none = assColor('#000000');
  const shade = assColor('#000000', 0x80);
  const gold = assColor('#FFD400');
  const styles =
    `Style: Head,Anton,140,${white},${white},${none},${shade},0,0,0,0,100,100,1,0,1,5,0,8,40,40,0,1\n` +
    `Style: Tag,Montserrat ExtraBold,36,${gold},${gold},${none},${shade},0,0,0,0,100,100,1,0,1,0,0,5,40,40,0,1\n` +
    `Style: Phone,Montserrat ExtraBold,28,${white},${white},${none},${shade},0,0,0,0,100,100,1,0,1,0,0,5,40,40,0,1\n`;
  ass = ass.replace('\n[Events]', styles + '\n[Events]');
  const end = assTime(input.duration + 0.5);
  const text = (input.headline ?? '').trim();
  if (text) {
    const { lines, size } = layoutHeadline(text, { ...FULLSCREEN_TEMPLATE.headline, enabled: true });
    const body = lines.map((l, i) => (i === 1 ? `{\\c${gold}}${l}{\\c${white}}` : l)).join('\\N');
    ass += `Dialogue: 3,${assTime(0)},${end},Head,,0,0,0,,{\\an8\\pos(540,${FS.headTop})\\fs${size}}${body}\n`;
  }
  ass +=
    `Dialogue: 3,${assTime(0)},${end},Tag,,0,0,0,,{\\an5\\pos(540,${FS.tagY})}${FS.tag}\n` +
    `Dialogue: 3,${assTime(0)},${end},Phone,,0,0,0,,{\\an5\\pos(540,${FS.phoneY})}${FS.phone}\n`;
  return ass;
}

const n = (x: number) => x.toFixed(3);

/**
 * Video chain for one segment of the reel in this look → label `[v<i>]` (1080x1920). `i` is the ffmpeg input index.
 * Blurred fills are made from a quarter-size copy (they are blurred anyway), which is several times cheaper than blurring full size.
 */
export function fullscreenSegmentChain(i: number, duration: number, layout: ShotLayout): string {
  const { W, H, picY, picH, line } = FS;
  const pic = coverCrop(layout.picture, W / picH);
  const host = layout.host;
  const hostW = Math.round((host.w * HOST_H) / host.h / 2) * 2;
  const fitW = Math.min(W, hostW);
  const hostX = Math.round((W - fitW) / 2);
  // when the host box is wider than the block, its sides are trimmed instead of scaled down
  const hostCrop = hostW > W ? { x: host.x + Math.round(((host.w - (host.h * W) / HOST_H) / 2)), y: host.y, w: Math.round((host.h * W) / HOST_H / 2) * 2, h: host.h } : host;
  const p = `v${i}`;
  return [
    `[${i}:v]setpts=PTS-STARTPTS,fps=30,trim=duration=${n(duration)},setpts=PTS-STARTPTS,split=4[${p}a][${p}b][${p}c][${p}d]`,
    `[${p}a]crop=${pic.w}:${pic.h}:${pic.x}:${pic.y},scale=${W / 4}:${H / 4},gblur=sigma=9,scale=${W}:${H}:flags=bilinear,eq=brightness=-0.3:saturation=0.9[${p}bg]`,
    `[${p}b]crop=${pic.w}:${pic.h}:${pic.x}:${pic.y},scale=${W}:${picH}:flags=lanczos,setsar=1[${p}pic]`,
    `[${p}c]crop=${hostCrop.w}:${hostCrop.h}:${hostCrop.x}:${hostCrop.y},scale=${fitW}:${HOST_H}:flags=lanczos,setsar=1[${p}host]`,
    `[${p}d]crop=${hostCrop.w}:${hostCrop.h}:${hostCrop.x}:${hostCrop.y},scale=${W / 4}:${Math.round(HOST_H / 8) * 2},gblur=sigma=7,scale=${W}:${HOST_H}:flags=bilinear,eq=brightness=-0.25[${p}hbg]`,
    `[${p}bg][${p}pic]overlay=0:${picY}[${p}t1]`,
    `[${p}t1][${p}hbg]overlay=0:${HOST_Y}[${p}t2]`,
    `[${p}t2][${p}host]overlay=${hostX}:${HOST_Y}[${p}t3]`,
    `[${p}t3]drawbox=x=0:y=${picY - line}:w=${W}:h=${line}:color=${FS.gold}:t=fill,drawbox=x=0:y=${HOST_Y}:w=${W}:h=${line}:color=${FS.gold}:t=fill,` +
      `drawbox=x=120:y=${FS.stripY}:w=840:h=${FS.stripH}:color=black@0.62:t=fill,setsar=1,format=yuv420p[${p}]`,
  ].join(';');
}

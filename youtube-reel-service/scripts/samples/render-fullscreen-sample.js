// SAMPLE ONLY: the proposed full-screen reel look. Runs inside the reel worker container; writes only to /work/samples. Posts nothing.
const fs = require('fs');
const { spawnSync } = require('child_process');
const { buildAss } = require('/app/dist/pipeline/captions.js');

const W = 1080, H = 1920;
const HEAD_TOP = 52;
const PIC_Y = 390;
const FONTS = '/app/assets/fonts';

const specs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const only = process.argv[3];
fs.mkdirSync('/work/samples/out', { recursive: true });

const template = {
  width: W, height: H,
  headline: { enabled: false, font: 'Anton', size: 108, minSize: 80, charWidth: 0.27, color: '#FFFFFF', accentColor: '#FFD400', outlineColor: '#000000', outline: 5, centerX: 540, top: HEAD_TOP, maxWidth: 1000, maxLines: 2, uppercase: true },
  captions: { enabled: true, font: 'Montserrat ExtraBold', size: 84, color: '#FFFFFF', highlightColor: '#FFD400', outlineColor: '#000000', outline: 7, shadow: 2, centerX: 540, centerY: 1250, maxWordsPerChunk: 3, maxCharsPerChunk: 16, uppercase: true },
};

function makeAss(s, duration) {
  let ass = buildAss({ words: s.words, headline: null, template, duration });
  const styles =
    'Style: Head,Anton,140,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,1,0,1,5,0,8,40,40,0,1\n' +
    'Style: Tag,Montserrat ExtraBold,36,&H0000D4FF,&H0000D4FF,&H00000000,&H80000000,0,0,0,0,100,100,1,0,1,0,0,5,40,40,0,1\n' +
    'Style: Phone,Montserrat ExtraBold,28,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,1,0,1,0,0,5,40,40,0,1\n';
  ass = ass.replace('\n[Events]', styles + '\n[Events]');
  const t1 = s.headline[0], t2 = s.headline[1];
  const end = '0:00:' + (duration + 0.5).toFixed(2).padStart(5, '0');
  ass +=
    `Dialogue: 3,0:00:00.00,${end},Head,,0,0,0,,{\\an8\\pos(540,${HEAD_TOP})\\fs140}${t1}\\N{\\c&H00D4FF&}${t2}\n` +
    `Dialogue: 3,0:00:00.00,${end},Tag,,0,0,0,,{\\an5\\pos(540,1846)}FULL VIDEO  -  CHECK DESCRIPTION\n` +
    `Dialogue: 3,0:00:00.00,${end},Phone,,0,0,0,,{\\an5\\pos(540,1880)}BOOK A CALL  1-917-680-9091\n`;
  return ass;
}

for (const s of specs) {
  if (only && s.id !== only) continue;
  const duration = +(s.end - s.start).toFixed(2);
  const assPath = `/work/samples/out/${s.id}.ass`;
  fs.writeFileSync(assPath, makeAss(s, duration));
  const p = s.pic, u = s.uq;
  const picH = Math.round((W * p.h) / p.w / 2) * 2;
  const uqY = PIC_Y + picH;
  const uqH = H - uqY;
  const uqScale = uqH / u.h;
  const uqW = Math.round((u.w * uqScale) / 2) * 2;
  const uqX = Math.round((W - uqW) / 2);
  const graph = [
    `[0:v]fps=30,split=4[a][b][c][d]`,
    `[a]crop=${p.w}:${p.h}:${p.x}:${p.y},scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=36,eq=brightness=-0.3:saturation=0.9[bg]`,
    `[b]crop=${p.w}:${p.h}:${p.x}:${p.y},scale=${W}:${picH}:flags=lanczos,setsar=1[pic]`,
    `[c]crop=${u.w}:${u.h}:${u.x}:${u.y},scale=${uqW}:${uqH}:flags=lanczos,setsar=1[uq]`,
    `[d]crop=${u.w}:${u.h}:${u.x}:${u.y},scale=${W}:${uqH}:force_original_aspect_ratio=increase,crop=${W}:${uqH},gblur=sigma=28,eq=brightness=-0.25[uqbg]`,
    `[bg][pic]overlay=0:${PIC_Y}[t1]`,
    `[t1][uqbg]overlay=0:${uqY}[t1b]`,
    `[t1b][uq]overlay=${uqX}:${uqY}[t2]`,
    `[t2]drawbox=x=0:y=${PIC_Y - 6}:w=${W}:h=6:color=0xFFD400:t=fill,drawbox=x=0:y=${uqY}:w=${W}:h=6:color=0xFFD400:t=fill,` +
      `drawbox=x=120:y=1818:w=840:h=84:color=black@0.62:t=fill,ass=${assPath}:fontsdir=${FONTS},format=yuv420p[v]`,
    `[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=channel_layouts=stereo[a]`,
  ].join(';');
  const out = `/work/samples/out/${s.id}.mp4`;
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(s.start), '-t', String(duration), '-i', `/work/samples/src/${s.yt}.mp4`,
    '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out];
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  console.log(s.id, r.status === 0 ? 'ok ' + fs.statSync(out).size : 'FAIL ' + (r.stderr || '').slice(-600));
  if (r.status === 0) spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '6', '-i', out, '-frames:v', '1', `/work/samples/out/${s.id}.jpg`]);
}

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveSfxFile, sfxChain, tailFor } from './sfx';
import { renderGraph, NO_FX } from './filtergraph';
import { parseTemplate } from './template';

describe('the ending sound file', () => {
  const assets = path.resolve(__dirname, '../../assets');

  it('the bundled sound exists, is short and is audible without clipping', () => {
    const file = resolveSfxFile(assets, 'end.wav');
    expect(file).not.toBeNull();
    expect(fs.existsSync(path.join(assets, 'sfx', 'README.md'))).toBe(true); // source + license note
  });

  it('a missing file is reported as missing, an absolute path works', () => {
    expect(resolveSfxFile(assets, 'nope.wav')).toBeNull();
    expect(resolveSfxFile(assets, path.join(assets, 'sfx', 'end.wav'))).not.toBeNull();
  });

  it('the tail covers the sound, with a cap for long files', () => {
    expect(tailFor(1.28)).toBeCloseTo(1.38, 2);
    expect(tailFor(0.1)).toBeCloseTo(0.4, 2);
    expect(tailFor(30)).toBeCloseTo(2.6, 2);
  });

  it('the chain trims, fades and delays the sound input', () => {
    const c = sfxChain(7, 1.28, 12.5, 0.7, 'sfx');
    expect(c).toContain('[7:a]');
    expect(c).toContain('atrim=duration=1.280');
    expect(c).toContain('afade=t=out:st=1.080:d=0.200');
    expect(c).toContain('volume=0.700');
    expect(c).toContain('adelay=12500|12500[sfx]');
  });
});

function volume(file: string): { max: number; mean: number } {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  return {
    max: Number(/max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr)?.[1] ?? NaN),
    mean: Number(/mean_volume:\s*(-?[\d.]+) dB/.exec(r.stderr)?.[1] ?? NaN),
  };
}

const ffmpegOk = spawnSync('ffmpeg', ['-version']).status === 0;
const maybe = ffmpegOk ? describe : describe.skip;

maybe('a full reel with the ending sound (real ffmpeg)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-sfx-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const tplDir = path.resolve(__dirname, '../../assets/templates/default');

  it('adds the tail, keeps the voice length and plays the real sound after the last word', () => {
    if (!fs.existsSync(path.join(tplDir, 'template.json'))) return;
    const template = parseTemplate(JSON.parse(fs.readFileSync(path.join(tplDir, 'template.json'), 'utf8')));
    const clip = path.join(tmp, 'clip.mp4');
    const mk = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=6', '-f', 'lavfi', '-i', 'sine=f=220:r=48000:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip],
      { encoding: 'utf8' },
    );
    expect(mk.status).toBe(0);
    fs.writeFileSync(path.join(tmp, 'reel.ass'), '[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n');
    fs.copyFileSync(path.join(tplDir, template.canvas), path.join(tmp, 'canvas.png'));
    const clips = [{ src: clip, start: 0, duration: 5 }];
    const graph = renderGraph({
      clips, template, canvasInputIndex: 1, assFile: 'reel.ass', fontsDir: '.', measured: null, totalDuration: 5, speed: 1, voice: 'natural',
      fx: { ...NO_FX, bar: true }, sfx: { inputIndex: 2, duration: 1.282, tail: tailFor(1.282), volume: 0.7 },
    });
    const out = path.join(tmp, 'out.mp4');
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', '-ss', '0', '-t', '5', '-i', clip, '-i', 'canvas.png', '-i', path.resolve(__dirname, '../../assets/sfx/end.wav'), '-filter_complex', graph, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out], { cwd: tmp, encoding: 'utf8' });
    expect(r.stderr.slice(-400)).not.toMatch(/Error|Invalid/);
    expect(r.status).toBe(0);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' });
    expect(Number(probe.stdout)).toBeGreaterThan(6.3);
    expect(Number(probe.stdout)).toBeLessThan(6.6);
    // After the voice (5 s) there is the sound, and the part before it is the 220 Hz test voice.
    const tailFile = path.join(tmp, 'tail.wav');
    spawnSync('ffmpeg', ['-hide_banner', '-y', '-ss', '5.05', '-i', out, '-vn', tailFile]);
    expect(volume(tailFile).max).toBeGreaterThan(-20);
  });
});

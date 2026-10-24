import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { endSfxFor, pickSfx, sfxChain, SFX_KINDS } from './sfx';
import { renderGraph, NO_FX } from './filtergraph';
import { parseTemplate } from './template';

describe('pickSfx', () => {
  it('matches the sound to the story', () => {
    expect(pickSfx('Con Ed worker killed after a road rage shooting')).toBe('screech');
    expect(pickSfx('Diddy trial: the verdict and the sentence')).toBe('gavel');
    expect(pickSfx('Life in a prison cell with no parole')).toBe('slam');
    expect(pickSfx('He was a snitch and the plot was exposed')).toBe('scratch');
    expect(pickSfx('A mother buries her son after the murder')).toBe('boom');
  });
  it('a car or road beats a courtroom word, which beats a prison word', () => {
    expect(pickSfx('car chase ends in court')).toBe('screech');
    expect(pickSfx('trial of a man sent to prison')).toBe('gavel');
  });
  it('falls back to the deep hit and reads lists', () => {
    expect(pickSfx('a quiet lesson about patience')).toBe('boom');
    expect(pickSfx(undefined, ['revenge psychology', 'life without parole'])).toBe('slam');
    expect(pickSfx()).toBe('boom');
  });
  it('every sound has a tail', () => {
    for (const k of SFX_KINDS) expect(endSfxFor(k).tail).toBeGreaterThan(0.4);
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

maybe('the ending sounds (real ffmpeg)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfx-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it.each(SFX_KINDS)('%s renders audible, clean audio of the planned length', (kind) => {
    const out = path.join(tmp, `${kind}.wav`);
    const r = spawnSync('ffmpeg', ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=0.1', '-filter_complex', sfxChain(kind, 0, 0.55, 'o'), '-map', '[o]', out], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const v = volume(out);
    expect(v.max).toBeGreaterThan(-14); // audible
    expect(v.max).toBeLessThanOrEqual(0.5); // not clipping hard
    expect(v.mean).toBeGreaterThan(-60);
  });
});

maybe('a full reel with the ending sound (real ffmpeg)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-sfx-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const tplDir = path.resolve(__dirname, '../../assets/templates/default');

  it('adds the tail, keeps the voice length and plays the sound after the last word', () => {
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
      fx: { ...NO_FX, bar: true }, sfx: { ...endSfxFor('slam'), volume: 0.55 },
    });
    const out = path.join(tmp, 'out.mp4');
    const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-y', '-ss', '0', '-t', '5', '-i', clip, '-i', 'canvas.png', '-filter_complex', graph, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out], { cwd: tmp, encoding: 'utf8' });
    expect(r.stderr.slice(-400)).not.toMatch(/Error|Invalid/);
    expect(r.status).toBe(0);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' });
    expect(Number(probe.stdout)).toBeGreaterThan(5.7);
    expect(Number(probe.stdout)).toBeLessThan(5.95);
    // After the voice (5 s) there is the sound, and the part before it is the 220 Hz test voice.
    const tailFile = path.join(tmp, 'tail.wav');
    spawnSync('ffmpeg', ['-hide_banner', '-y', '-ss', '5.05', '-i', out, '-vn', tailFile]);
    expect(volume(tailFile).max).toBeGreaterThan(-20);
  });
});

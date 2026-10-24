import * as fs from 'fs';
import * as path from 'path';

/**
 * Ending sound for a reel (client request: end the Shorts with a car screech).
 *
 * One recorded sound file (assets/sfx, see the README there for source and license) plays in a short tail
 * after the last word, so it is never talked over. It is the same for every reel; to change it, replace the
 * file or set REEL_END_SFX_FILE.
 */
export interface EndSfx {
  /** Display name, stored on the reel (the file name). */
  name: string;
  /** Absolute path of the sound file. */
  file: string;
  /** Length of the sound in seconds. */
  duration: number;
  /** Seconds added after the last word (the last picture holds while the sound plays). */
  tail: number;
}

const MAX_SOUND = 2.5;
const PAD_AFTER = 0.1;

/** The tail needed for a sound of this length (short sounds are never cut, long ones are capped). */
export function tailFor(duration: number): number {
  return Math.round((Math.min(Math.max(duration, 0.3), MAX_SOUND) + PAD_AFTER) * 100) / 100;
}

/** Finds the configured sound file: a name inside assets/sfx, or an absolute path. Null when it is missing. */
export function resolveSfxFile(assetsDir: string, name: string): string | null {
  const file = path.isAbsolute(name) ? name : path.join(assetsDir, 'sfx', name);
  return fs.existsSync(file) ? file : null;
}

/** The filter chain that turns the sound input into `[label]`, starting at `atSec` and fading out at its end. */
export function sfxChain(inputIndex: number, duration: number, atSec: number, volume: number, label: string): string {
  const ms = Math.max(0, Math.round(atSec * 1000));
  const length = Math.min(Math.max(duration, 0.3), MAX_SOUND);
  const fade = Math.min(0.2, length / 3);
  return (
    `[${inputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${length.toFixed(3)},` +
    `afade=t=in:d=0.005,afade=t=out:st=${(length - fade).toFixed(3)}:d=${fade.toFixed(3)},volume=${volume.toFixed(3)},adelay=${ms}|${ms}[${label}]`
  );
}

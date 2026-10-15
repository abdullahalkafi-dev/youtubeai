import * as fs from 'fs';
import * as path from 'path';
import { run } from '../common/exec';

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  size: number;
}

export async function probeMedia(ffprobe: string, input: string): Promise<ProbeResult> {
  const { stdout } = await run(
    ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration,size:stream=codec_type,width,height,avg_frame_rate', '-of', 'json', input],
    { timeoutMs: 60_000 },
  );
  const data = JSON.parse(stdout || '{}');
  const streams: any[] = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video');
  const [num, den] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number);
  return {
    duration: Number(data.format?.duration ?? 0),
    size: Number(data.format?.size ?? 0),
    width: Number(v?.width ?? 0),
    height: Number(v?.height ?? 0),
    fps: den ? num / den : 0,
    hasVideo: !!v,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function removeDir(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Free space on the filesystem holding `dir`, in GB. */
export function freeDiskGb(dir: string): number {
  try {
    const st = fs.statfsSync(dir);
    return (st.bavail * st.bsize) / 1024 ** 3;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function jobDir(workDir: string, kind: string, id: string): string {
  return ensureDir(path.join(workDir, 'jobs', `${kind}-${id}-${Date.now()}`));
}

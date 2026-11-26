import { spawn } from 'child_process';

export interface ExecOptions {
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Run with lower CPU priority so the rest of the box stays responsive. */
  lowPriority?: boolean;
  /** Abort signal (e.g. campaign cancelled). */
  signal?: AbortSignal;
  /** Keep at most this many chars of stdout (stderr tail is always kept). */
  maxStdout?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class ExecError extends Error {
  constructor(
    message: string,
    readonly result: ExecResult,
  ) {
    super(message);
    this.name = 'ExecError';
  }
}

const STDERR_TAIL = 16_000;

/**
 * Spawn a binary with an args array (never a shell string), a hard timeout and
 * process-group kill so ffmpeg / yt-dlp children never outlive the job.
 */
export function run(bin: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const started = Date.now();
  const useNice = opts.lowPriority && process.platform !== 'win32';
  const cmd = useNice ? 'nice' : bin;
  const cmdArgs = useNice ? ['-n', '10', bin, ...args] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const maxStdout = opts.maxStdout ?? 4_000_000;
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < maxStdout) stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > STDERR_TAIL * 2) stderr = stderr.slice(-STDERR_TAIL);
    });

    let killedReason: string | null = null;
    const kill = (reason: string) => {
      if (killedReason) return;
      killedReason = reason;
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    };

    const timer = opts.timeoutMs ? setTimeout(() => kill(`timeout after ${opts.timeoutMs}ms`), opts.timeoutMs) : null;
    const onAbort = () => kill('aborted');
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      const result: ExecResult = {
        code: code ?? -1,
        stdout,
        stderr: stderr.slice(-STDERR_TAIL),
        durationMs: Date.now() - started,
      };
      if (killedReason) {
        reject(new ExecError(`${bin} ${killedReason}`, result));
      } else if (result.code !== 0) {
        reject(new ExecError(`${bin} exited with code ${result.code}: ${lastLines(result.stderr, 6)}`, result));
      } else {
        resolve(result);
      }
    });
  });
}

export function lastLines(text: string, n: number): string {
  return text.trim().split(/\r?\n/).slice(-n).join(' | ');
}

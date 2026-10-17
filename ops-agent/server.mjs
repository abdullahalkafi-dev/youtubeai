// Ops agent: read-only server health + container logs for the developer portal (/developer).
// No dependencies. Talks to the Docker Engine over its unix socket using GET requests only.
// Access: the main app's JWT (shared secret) AND an email allowlist (OPS_ALLOWED_EMAILS).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';

const PORT = Number(process.env.PORT || 5003);
const SECRET = process.env.JWT_SECRET || '';
const ALLOWED = (process.env.OPS_ALLOWED_EMAILS || 'admin@prod.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const PREFIX = process.env.OPS_CONTAINER_PREFIX || 'youtubeai-';
const PROC = process.env.HOST_PROC || '/host/proc';
const SOCK = '/var/run/docker.sock';

if (!SECRET) {
  console.error('JWT_SECRET is required');
  process.exit(1);
}

// ------------------------------------------------------------------ auth (HS256 JWT)
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function verifyJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  let header;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString());
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;
  const expected = b64url(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
function authorize(req) {
  const h = req.headers.authorization || '';
  const payload = h.startsWith('Bearer ') ? verifyJwt(h.slice(7)) : null;
  if (!payload) return { status: 401, error: 'Please sign in again' };
  const email = String(payload.email || '').toLowerCase();
  if (!ALLOWED.includes(email)) return { status: 403, error: 'The developer portal is only for developer accounts' };
  return { email };
}

// ------------------------------------------------------------------ docker (GET only)
function docker(path, { stream = false, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCK, path, method: 'GET', timeout: timeoutMs }, (res) => {
      if (stream) return resolve(res);
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 400) return reject(new Error(`docker ${res.statusCode}: ${body.toString().slice(0, 200)}`));
        resolve(body);
      });
    });
    req.on('timeout', () => req.destroy(new Error('docker timeout')));
    req.on('error', reject);
    req.end();
  });
}
const dockerJson = async (path, opts) => JSON.parse((await docker(path, opts)).toString());

async function listContainers() {
  const all = await dockerJson('/containers/json?all=1');
  return all
    .map((c) => ({ id: c.Id, name: (c.Names?.[0] || '').replace(/^\//, ''), image: c.Image, state: c.State, status: c.Status, project: c.Labels?.['com.docker.compose.project'] || '', service: c.Labels?.['com.docker.compose.service'] || '' }))
    .filter((c) => c.name.startsWith(PREFIX))
    .sort((a, b) => a.name.localeCompare(b.name));
}
async function findContainer(name) {
  const list = await listContainers();
  return list.find((c) => c.name === name) || null;
}

// ------------------------------------------------------------------ host metrics
let lastCpu = null;
function readCpu() {
  const line = fs.readFileSync(`${PROC}/stat`, 'utf8').split('\n')[0];
  const v = line.trim().split(/\s+/).slice(1).map(Number);
  const idle = v[3] + (v[4] || 0);
  const total = v.reduce((a, b) => a + b, 0);
  return { idle, total };
}
function cpuPercent() {
  try {
    const now = readCpu();
    const prev = lastCpu;
    lastCpu = now;
    if (!prev || now.total === prev.total) return null;
    return Math.max(0, Math.min(100, (1 - (now.idle - prev.idle) / (now.total - prev.total)) * 100));
  } catch {
    return null;
  }
}
function memory() {
  const kv = {};
  for (const line of fs.readFileSync(`${PROC}/meminfo`, 'utf8').split('\n')) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) kv[m[1]] = Number(m[2]) * 1024;
  }
  return { total: kv.MemTotal, available: kv.MemAvailable, used: kv.MemTotal - kv.MemAvailable, swapTotal: kv.SwapTotal, swapUsed: kv.SwapTotal - kv.SwapFree };
}
function disk() {
  const s = fs.statfsSync('/');
  const total = s.blocks * s.bsize;
  const free = s.bavail * s.bsize;
  return { total, free, used: total - free };
}
function hostInfo() {
  const load = fs.readFileSync(`${PROC}/loadavg`, 'utf8').trim().split(/\s+/).slice(0, 3).map(Number);
  const uptimeSec = Number(fs.readFileSync(`${PROC}/uptime`, 'utf8').split(' ')[0]);
  const cores = (fs.readFileSync(`${PROC}/stat`, 'utf8').match(/^cpu\d+ /gm) || []).length;
  return { load, uptimeSec, cores };
}

// Per-container stats (one-shot). Cached briefly: each call costs ~1s inside Docker.
let statsCache = { at: 0, data: [] };
async function containerStats() {
  if (Date.now() - statsCache.at < 4000) return statsCache.data;
  const list = await listContainers();
  const data = await Promise.all(
    list.map(async (c) => {
      if (c.state !== 'running') return { ...c, cpu: null, mem: null, memLimit: null };
      try {
        const s = await dockerJson(`/containers/${c.id}/stats?stream=false&one-shot=false`, { timeoutMs: 8000 });
        const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
        const sysDelta = (s.cpu_stats.system_cpu_usage || 0) - (s.precpu_stats.system_cpu_usage || 0);
        const online = s.cpu_stats.online_cpus || 1;
        const cpu = sysDelta > 0 ? (cpuDelta / sysDelta) * online * 100 : 0;
        const cache = s.memory_stats.stats?.inactive_file ?? s.memory_stats.stats?.cache ?? 0;
        const net = Object.values(s.networks || {}).reduce((a, n) => ({ rx: a.rx + n.rx_bytes, tx: a.tx + n.tx_bytes }), { rx: 0, tx: 0 });
        return { ...c, cpu: Math.round(cpu * 10) / 10, mem: Math.max(0, (s.memory_stats.usage || 0) - cache), memLimit: s.memory_stats.limit || null, net };
      } catch {
        return { ...c, cpu: null, mem: null, memLimit: null };
      }
    }),
  );
  statsCache = { at: Date.now(), data };
  return data;
}

let dfCache = { at: 0, data: null };
async function dockerDisk() {
  if (dfCache.data && Date.now() - dfCache.at < 10 * 60_000) return dfCache.data;
  try {
    const df = await dockerJson('/system/df', { timeoutMs: 60000 });
    const volumes = (df.Volumes || [])
      .filter((v) => v.UsageData?.Size > 0)
      .map((v) => ({ name: v.Name, size: v.UsageData.Size }))
      .sort((a, b) => b.size - a.size)
      .slice(0, 12);
    const images = (df.Images || []).reduce((a, i) => a + (i.Size || 0), 0);
    const buildCache = (df.BuildCache || []).reduce((a, b) => a + (b.Size || 0), 0);
    dfCache = { at: Date.now(), data: { volumes, images, buildCache } };
  } catch {
    /* keep the old value */
  }
  return dfCache.data;
}

// ------------------------------------------------------------------ logs
// Secrets that must never reach the browser even if an app logs them by mistake.
const REDACT = [
  [/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/g, '$1•••'],
  [/\bya29\.[A-Za-z0-9\-_]+/g, 'ya29.•••'],
  [/\b1\/\/0[A-Za-z0-9\-_]{20,}/g, '1//•••'],
  [/\bsk-[A-Za-z0-9\-_]{16,}/g, 'sk-•••'],
  [/(mongodb(?:\+srv)?:\/\/[^:\s/]+:)[^@\s]+@/g, '$1•••@'],
  [/((?:password|passwd|secret|token|api[_-]?key|refresh_token|access_token)["']?\s*[:=]\s*["']?)[^"'\s,}]{4,}/gi, '$1•••'],
];
const redact = (s) => REDACT.reduce((t, [re, rep]) => t.replace(re, rep), s);
// eslint-disable-next-line no-control-regex
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

/** Docker log stream → lines. Non-TTY containers use 8-byte frame headers (stream type + length). */
function makeLineParser(tty, onLine) {
  let buf = Buffer.alloc(0);
  const pending = { stdout: '', stderr: '' };
  const emitText = (stream, text) => {
    const parts = (pending[stream] + text).split('\n');
    pending[stream] = parts.pop();
    for (const raw of parts) {
      if (!raw) continue;
      const sp = raw.indexOf(' ');
      const ts = sp > 0 && /^\d{4}-\d\d-\d\dT/.test(raw) ? raw.slice(0, sp) : null;
      const text = redact(stripAnsi(ts ? raw.slice(sp + 1) : raw)).replace(/\r$/, '');
      onLine({ ts, stream, text });
    }
  };
  return {
    push(chunk) {
      if (tty) return emitText('stdout', chunk.toString('utf8'));
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 8) {
        const size = buf.readUInt32BE(4);
        if (buf.length < 8 + size) break;
        const stream = buf[0] === 2 ? 'stderr' : 'stdout';
        emitText(stream, buf.subarray(8, 8 + size).toString('utf8'));
        buf = buf.subarray(8 + size);
      }
    },
    flush() {
      for (const s of ['stdout', 'stderr']) if (pending[s]) emitText(s, '\n');
    },
  };
}

async function readLogs(name, { tail, since }) {
  const c = await findContainer(name);
  if (!c) return null;
  const info = await dockerJson(`/containers/${c.id}/json`);
  const q = new URLSearchParams({ stdout: '1', stderr: '1', timestamps: '1', tail: String(tail) });
  if (since) q.set('since', String(since));
  const body = await docker(`/containers/${c.id}/logs?${q}`, { timeoutMs: 30000 });
  const lines = [];
  const parser = makeLineParser(!!info.Config?.Tty, (l) => lines.push(l));
  parser.push(body);
  parser.flush();
  return lines;
}

// ------------------------------------------------------------------ http
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/^\/api\/ops/, '') || '/';
  try {
    if (req.method !== 'GET') return send(res, 405, { error: 'Read-only' });
    if (path === '/health') return send(res, 200, { ok: true });

    const auth = authorize(req);
    if (auth.error) return send(res, auth.status, { error: auth.error });

    if (path === '/me') return send(res, 200, { email: auth.email, allowed: true });

    if (path === '/system') {
      const [containers, dockerDf] = await Promise.all([containerStats(), dockerDisk()]);
      return send(res, 200, { at: new Date().toISOString(), cpu: cpuPercent(), memory: memory(), disk: disk(), host: hostInfo(), containers, docker: dockerDf });
    }

    if (path === '/containers') return send(res, 200, await listContainers());

    const m = /^\/logs\/([A-Za-z0-9_.-]+)(\/stream)?$/.exec(path);
    if (m) {
      const name = m[1];
      if (!name.startsWith(PREFIX)) return send(res, 404, { error: 'Unknown container' });
      if (!m[2]) {
        const tail = Math.min(5000, Math.max(1, Number(url.searchParams.get('tail')) || 500));
        const since = Number(url.searchParams.get('since')) || 0;
        const lines = await readLogs(name, { tail, since });
        if (!lines) return send(res, 404, { error: 'Unknown container' });
        return send(res, 200, { container: name, lines });
      }
      // Live follow: newline-delimited JSON, one line per log line, plus a heartbeat every 15s.
      const c = await findContainer(name);
      if (!c) return send(res, 404, { error: 'Unknown container' });
      const info = await dockerJson(`/containers/${c.id}/json`);
      const q = new URLSearchParams({ stdout: '1', stderr: '1', timestamps: '1', follow: '1', tail: '0' });
      const upstream = await docker(`/containers/${c.id}/logs?${q}`, { stream: true, timeoutMs: 0 });
      res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' });
      const parser = makeLineParser(!!info.Config?.Tty, (l) => res.write(JSON.stringify(l) + '\n'));
      const beat = setInterval(() => res.write('{"heartbeat":true}\n'), 15000);
      upstream.on('data', (chunk) => parser.push(chunk));
      upstream.on('end', () => {
        clearInterval(beat);
        res.end();
      });
      req.on('close', () => {
        clearInterval(beat);
        upstream.destroy();
      });
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(`[ops] ${req.method} ${path}: ${err.message}`);
    if (!res.headersSent) send(res, 500, { error: 'Could not read this right now' });
    else res.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  cpuPercent(); // prime the CPU delta
  console.log(`[ops] listening on ${PORT}; allowed: ${ALLOWED.join(', ')}`);
});

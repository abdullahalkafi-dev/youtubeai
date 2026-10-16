import { lookup } from 'dns/promises';
import { request } from 'https';
import { isIP } from 'net';

export interface RetrievedSource {
  url: string;
  title?: string;
  text: string;
  retrievedAt: string;
  error?: string;
}
export interface ResearchFact {
  claim: string;
  status: 'verified' | 'disputed' | 'unverified';
  evidence: { url: string; quote: string }[];
}
export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19].includes(b))
    );
  }
  // Only global unicast IPv6. Excludes mapped IPv4, loopback, link-local and ULA.
  return (
    isIP(address) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(address) &&
    !/^2001:(?:db8|0):/i.test(address)
  );
}
const plain = (value: string) =>
  value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Bounded HTTPS retrieval, pinned to checked DNS addresses; revalidate each redirect. */
export async function retrieveSource(
  url: string,
  title?: string,
  redirects = 0,
): Promise<RetrievedSource> {
  const result: RetrievedSource = {
    url,
    title,
    text: '',
    retrievedAt: new Date().toISOString(),
  };
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== '443')
    )
      throw new Error('Unsupported source URL');
    let dnsDeadline: ReturnType<typeof setTimeout> | undefined;
    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = await Promise.race([
        lookup(parsed.hostname, { all: true }),
        new Promise<never>((_resolve, reject) => {
          dnsDeadline = setTimeout(
            () => reject(new Error('Source DNS lookup timed out')),
            3000,
          );
        }),
      ]);
    } finally {
      if (dnsDeadline) clearTimeout(dnsDeadline);
    }
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error('Source address is not public');
    const response = await new Promise<{ text?: string; redirect?: string }>(
      (resolve, reject) => {
        const req = request(
          parsed,
          {
            headers: {
              'User-Agent': 'ContentStudioResearch/1.0',
              Accept: 'text/html,text/plain',
            },
            lookup: ((_hostname: string, _options: any, cb: any) =>
              _options.all
                ? cb(null, addresses)
                : cb(null, addresses[0].address, addresses[0].family)) as any,
          },
          (res) => {
            if (
              [301, 302, 303, 307, 308].includes(res.statusCode || 0) &&
              res.headers.location
            ) {
              res.resume();
              resolve({ redirect: new URL(res.headers.location, parsed).href });
              return;
            }
            if (
              res.statusCode !== 200 ||
              !/text\/(html|plain)/i.test(String(res.headers['content-type']))
            ) {
              res.resume();
              reject(new Error('Source content unavailable'));
              return;
            }
            let size = 0;
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => {
              size += chunk.length;
              if (size > 512000) {
                req.destroy(new Error('Source exceeds retrieval limit'));
                return;
              }
              chunks.push(chunk);
            });
            res.on('end', () =>
              resolve({ text: Buffer.concat(chunks).toString('utf8') }),
            );
            res.on('error', reject);
          },
        );
        const deadline = setTimeout(
          () => req.destroy(new Error('Source retrieval timed out')),
          8000,
        );
        req.on('close', () => clearTimeout(deadline));
        req.on('error', reject);
        req.end();
      },
    );
    if (response.redirect) {
      if (redirects >= 2) throw new Error('Source redirect limit');
      const followed = await retrieveSource(
        response.redirect,
        title,
        redirects + 1,
      );
      return { ...followed, url };
    }
    result.text = plain(response.text || '').slice(0, 24000);
  } catch (error: any) {
    result.error = error.message;
  }
  return result;
}
export function validateResearchFacts(
  input: any,
  sources: RetrievedSource[],
): ResearchFact[] {
  const normalize = (value: string) =>
    value.replace(/\s+/g, ' ').trim().toLowerCase();
  const retrieved = new Map(
    sources
      .filter((s) => s.text && !s.error)
      .map((s) => [s.url, normalize(s.text)]),
  );
  return (Array.isArray(input?.facts) ? input.facts : [])
    .filter((f: any) => typeof f?.claim === 'string')
    .slice(0, 40)
    .map((f: any) => {
      const evidence = (Array.isArray(f.evidence) ? f.evidence : [])
        .filter(
          (e: any) =>
            typeof e?.url === 'string' &&
            typeof e?.quote === 'string' &&
            e.quote.trim().length >= 20 &&
            retrieved.get(e.url)?.includes(normalize(e.quote)),
        )
        .map((e: any) => ({ url: e.url, quote: e.quote }));
      return {
        claim: f.claim,
        status: evidence.length
          ? f.status === 'disputed'
            ? 'disputed'
            : f.status === 'verified'
              ? 'verified'
              : 'unverified'
          : 'unverified',
        evidence,
      };
    });
}
export function coverageTerms(topic: string, subjects: string[]): string[] {
  return [
    ...new Set([
      ...subjects,
      ...topic
        .split(/[^a-z0-9]+/i)
        .filter(
          (t) =>
            t.length >= 4 &&
            !/^(about|video|write|with|this|that|what|from|your|script)$/i.test(
              t,
            ),
        ),
    ]),
  ].slice(0, 15);
}

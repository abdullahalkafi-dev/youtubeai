/**
 * Who the reels are for. Injected into every creative prompt so all stages share one voice.
 * Source: client context brief (channel owner interview + channel analytics).
 */
export const CHANNEL_PROFILE = {
  name: 'Unique Mecca Audio',
  handle: '@uniquemeccaaudionyc',
  host:
    'Unique Mecca Audio — 62 years old, served 26 years in federal prison (1993–2020), former Harlem kingpin, ' +
    'author of "A Roaring Harlem". Speaks from lived experience, not from headlines.',
  voice:
    'Dark, direct, street-wise and professorial — a "street psychiatrist" teaching criminology to students. ' +
    'Short punchy lines. He closes ideas with a moral lesson he calls a "jewel".',
  niche:
    'Criminal psychology through lived prison experience: street code vs court code, prison intake and survival, ' +
    'federal pressure, loyalty and snitching, consequences, warnings to the youth. He breaks down trending crime / ' +
    'hip-hop legal stories (Diddy, Lil Durk, Karmelo Anthony, Yo Gotti, Pooh Shiesty, etc.) with his firsthand perspective. NOT news reading.',
  audience:
    'Global, heavily US urban, hip-hop and true-crime viewers. A loyal community that values "real talk"; many young men he wants to warn.',
  whatWins:
    'First night / first day / intake / survival-code content and his personal authority crush news-style recaps. ' +
    'Named-case hooks + his insider verdict + a hard lesson = his best performers.',
  filter:
    'If the moment cannot save somebody, teach somebody, warn somebody, or wake somebody up — it does not deserve the audience\'s trust.',
  safety:
    'YouTube-safe: never glorify violence or drug dealing, no how-to crime, never present unproven allegations about real people as fact ' +
    '(frame as allegation or as his analysis), no slurs in on-screen text.',
} as const;

export function renderChannelProfile(): string {
  const p = CHANNEL_PROFILE;
  return [
    `CHANNEL: ${p.name} (${p.handle})`,
    `HOST: ${p.host}`,
    `VOICE: ${p.voice}`,
    `NICHE: ${p.niche}`,
    `AUDIENCE: ${p.audience}`,
    `WHAT WINS: ${p.whatWins}`,
    `TRUST FILTER: ${p.filter}`,
    `SAFETY: ${p.safety}`,
  ].join('\n');
}

import { parseSourceScript } from './source-script';
import {
  coverageTerms,
  publicAddress,
  validateResearchFacts,
} from './research';

const speech = (script: any) =>
  script.sections
    .flatMap((section: any) => [
      ...section.blocks.flatMap((block: any) => block.lines),
      ...(section.jewel || []),
    ])
    .join(' ')
    .split(/\s+/);
describe('formatting source preservation', () => {
  it('preserves every pasted spoken token including punctuation and names', () => {
    const original =
      "I called my family. Nobody knew what to say. Keefe D wasn't the story; this was my life.";
    const result = parseSourceScript(
      'Make this breathable.\n\nScript:\n' + original,
    )!;
    expect(speech(result)).toEqual(original.split(/\s+/));
  });
  it('handles legacy block quotes, section names, jewels and pause cues', () => {
    const result = parseSourceScript(
      '<!-- SCRIPT_START -->\n# SCRIPT TITLE: Family\n## The call\n\n> I picked up the phone.\n> She asked about tomorrow.\n\n[PAUSE]\n### JEWEL\n> Tell them the truth.\n<!-- SCRIPT_END -->\n## Sources\nhttps://example.test',
    )!;
    expect(result.title).toBe('Family');
    expect(speech(result).join(' ')).toBe(
      'I picked up the phone. She asked about tomorrow. Tell them the truth.',
    );
    expect(result.sections[0].blocks[0].cue).toBe('PAUSE');
  });
  it('ignores the user instruction after an active script context', () => {
    const result = parseSourceScript(
      '[ACTIVE SCRIPT CONTEXT]\n# SCRIPT TITLE: First night\n> This is my exact story.\n[USER REQUEST]\nFormat my script',
    )!;
    expect(speech(result).join(' ')).toBe('This is my exact story.');
  });
  it.each([
    'Format this for the teleprompter.\n\nMy family waited for this call.',
    'Format this script: My family waited for this call.',
  ])('accepts plain pasted speech without special delimiters', (input) => {
    expect(speech(parseSourceScript(input)).join(' ')).toBe(
      'My family waited for this call.',
    );
  });
  it('requires an identifiable source instead of rewriting an instruction', () => {
    expect(parseSourceScript('Make my script breathable')).toBeNull();
  });
});
describe('research evidence boundaries', () => {
  const source = {
    url: 'https://example.test/story',
    text: 'The family telephone call lasted for fifteen minutes.',
    retrievedAt: '2026-10-16',
  };
  it('does not mark claims verified from a URL or invented quote', () => {
    const facts = validateResearchFacts(
      {
        facts: [
          {
            claim: 'A happened',
            status: 'verified',
            evidence: [
              {
                url: source.url,
                quote: 'This invented event definitely never happened.',
              },
            ],
          },
          {
            claim: 'B happened',
            status: 'verified',
            evidence: [{ url: 'https://unretrieved.test', quote: source.text }],
          },
          {
            claim: 'The call lasted fifteen minutes',
            status: 'verified',
            evidence: [{ url: source.url, quote: source.text }],
          },
          {
            claim: 'The reported length is contested',
            status: 'disputed',
            evidence: [{ url: source.url, quote: source.text }],
          },
        ],
      },
      [source],
    );
    expect(facts.map((fact) => fact.status)).toEqual([
      'unverified',
      'unverified',
      'verified',
      'disputed',
    ]);
    expect(facts[0].evidence).toEqual([]);
  });
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.1.2',
    '192.168.0.1',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    'fe80::1',
    'fc00::1',
  ])('rejects nonpublic source address %s', (address) => {
    expect(publicAddress(address)).toBe(false);
  });
  it('accepts public addresses and escapes no arbitrary regex input here', () => {
    expect(publicAddress('8.8.8.8')).toBe(true);
    expect(publicAddress('2606:4700::1111')).toBe(true);
    expect(coverageTerms('Keefe D family call', ['Keefe D'])).toContain(
      'Keefe D',
    );
  });
});

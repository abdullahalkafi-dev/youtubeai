import {
  BULLET_SCRIPT_END,
  BULLET_SCRIPT_INSTRUCTION,
  BULLET_SCRIPT_START,
  TWIST_SHAPES,
  buildTwistBrief,
  buildUniquePersona,
  pickTwistShapes,
  withUniquePersona,
} from './unique-persona';

describe('unique persona', () => {
  const clean = buildUniquePersona(false);
  const explicit = buildUniquePersona(true);

  it('writes AS the reformed outlaw, not a classroom professor', () => {
    expect(clean).toMatch(/outlaw to everything the law stands for/i);
    expect(clean).toMatch(/does not work with the police, ever/i);
    expect(clean).toMatch(/not a teacher by trade/i);
    expect(clean).toMatch(/street OG gangster professor/i);
  });

  it('keeps the client quotes verbatim', () => {
    expect(clean).toContain("You're not trying to convince people that the criminal is right.");
    expect(clean).toContain('RSA — rational self-thinking');
    expect(clean).toContain('Write it like a criminal is writing it');
  });

  it('keeps the racial slur out unless explicit language is switched on', () => {
    expect(clean).not.toMatch(/nigg/i);
    expect(clean).toMatch(/Do not use racial slurs/);
    expect(explicit).toMatch(/N-word/);
    expect(explicit).toMatch(/nigga in the street/i);
  });

  it('defines the twist as a fixed slot with dynamic content', () => {
    expect(clean).toMatch(/POINT 2 is always the Unique twist/);
    expect(clean).toMatch(/NEVER feel templated/);
    expect(clean).toMatch(/never a fixed label/i);
    for (const shape of TWIST_SHAPES) expect(clean).toContain(shape.label);
  });

  it('says the legal caution once and frames inside-the-head passages as his read', () => {
    expect(clean).toMatch(/LEGAL CAUTION, ONCE/);
    expect(clean).toMatch(/Unique's read/);
  });

  it('is appended last and can be switched off', () => {
    const base = 'BASE PROMPT';
    process.env.UMA_PERSONA = 'false';
    expect(withUniquePersona(base)).toBe(base);
    delete process.env.UMA_PERSONA;
    const withIt = withUniquePersona(base);
    expect(withIt.startsWith(base)).toBe(true);
    expect(withIt.length).toBeGreaterThan(base.length + 2000);
  });

  it('twist brief rotates shapes and warns against echoing earlier twists', () => {
    const seeds = [0.01, 0.35, 0.7, 0.99];
    const seen = new Set<string>();
    for (const s of seeds) {
      const brief = buildTwistBrief([], () => s);
      expect(brief).toMatch(/DIFFERENT opening, section title and skeleton/);
      for (const t of TWIST_SHAPES) if (brief.includes(`"${t.label}"`)) seen.add(t.key);
    }
    expect(seen.size).toBeGreaterThan(2);

    const recent = [{ title: 'THE COLD MATH OF A STREET DEBT', opening: 'Three hundred dollars.' }];
    const brief = buildTwistBrief(recent);
    expect(brief).toContain('THE COLD MATH OF A STREET DEBT');
    expect(brief).toMatch(/do NOT echo/);
    const picks = pickTwistShapes(recent, 2, () => 0.2);
    expect(picks).toHaveLength(2);
    expect(picks.map((p) => p.label)).not.toContain('The cold math');
  });

  it('bullet instruction uses its own markers and the two-line rule', () => {
    expect(BULLET_SCRIPT_START).not.toBe('<!-- SCRIPT_START -->');
    expect(BULLET_SCRIPT_INSTRUCTION).toContain(BULLET_SCRIPT_START);
    expect(BULLET_SCRIPT_INSTRUCTION).toContain(BULLET_SCRIPT_END);
    expect(BULLET_SCRIPT_INSTRUCTION).toMatch(/EXACTLY two "> " lines/);
    expect(BULLET_SCRIPT_INSTRUCTION).toMatch(/Point 2 is the Unique twist point/);
  });
});

describe('unique persona: voice rules learned from a real generation test', () => {
  const text = buildUniquePersona(false);

  it('requires the raw first reaction to be spoken, not described, and never endorsed', () => {
    expect(text).toMatch(/THE RAW FIRST REACTION/);
    expect(text).toMatch(/first person, past tense/);
    expect(text).toMatch(/never endorsed, and it never urges violence against a real person/);
  });

  it('forbids counselor-style advice and citing the book', () => {
    expect(text).toMatch(/DON'T PREACH OR COUNSEL/);
    expect(text).toMatch(/No practical-advice lists/);
    expect(text).toMatch(/Never cite it \("in my book"/);
  });

  it('keeps bullet explanations to one hard sentence per line', () => {
    expect(BULLET_SCRIPT_INSTRUCTION).toMatch(/ONE hard sentence of at most 20 words/);
    expect(BULLET_SCRIPT_INSTRUCTION).toMatch(/Hedges and disclaimers do not belong inside the bullets/);
  });
});

describe('unique persona: concrete reaction, no self-narrated caution', () => {
  const text = buildUniquePersona(false);
  it('shows a wrong and a right version of the raw reaction', () => {
    expect(text).toMatch(/CONCRETE spoken thought/);
    expect(text).toMatch(/WRONG: "The criminal mind starts searching/);
    expect(text).toMatch(/RIGHT: "First thing in my head: what did she say to him/);
  });
  it('bans announcing what is not invented or not known', () => {
    expect(text).toMatch(/DON'T NARRATE YOUR OWN CAUTION/);
    expect(text).toMatch(/A man on camera does not read his own disclaimers/);
  });
});

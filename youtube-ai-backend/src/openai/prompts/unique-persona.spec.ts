import {
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
});

describe('unique persona v4: the OG speaks from inside, not as a commentator', () => {
  const text = buildUniquePersona(false);

  it('puts every point through the four inside beats, not only point 2', () => {
    expect(text).toMatch(/EVERY POINT IS SPOKEN FROM INSIDE/);
    for (const beat of ['THE OLD MIND', 'THE CROWD', 'THE COST', 'THE ORDER']) expect(text).toContain(beat);
  });

  it('bans commentator phrases and caps the "That\'s" openers and "X ain\'t Y" jewels', () => {
    expect(text).toMatch(/NEVER THE COMMENTATOR/);
    expect(text).toMatch(/"my read", "my analysis", "the mechanism"/);
    expect(text).toMatch(/No more than two sentences in the whole script may begin with "That's"/);
    expect(text).toMatch(/no more than two may be shaped "X ain't Y"/);
  });

  it('goes inside the seat at least twice and treats prison as home field without claiming private facts', () => {
    expect(text).toMatch(/GO INSIDE THE SEAT/);
    expect(text).toMatch(/Tesla-trunk level of detail/);
    expect(text).toMatch(/PRISON IS HIS HOME FIELD/);
    expect(text).toMatch(/commissary/);
    expect(text).toMatch(/never claim what a named real person did, said or felt there/);
  });

  it('keeps earlier-chat caveats silent and the book scenes true to the page', () => {
    expect(text).toMatch(/EARLIER MESSAGES IN THE CHAT/);
    expect(text).toMatch(/Never speak them out loud as disclaimers/);
    expect(text).toMatch(/THE BOOK STAYS TRUE/);
    expect(text).toMatch(/do not turn the victim into an innocent civilian/);
  });

  it('never cleans up the old self: the memory includes what he did and what it cost', () => {
    expect(text).toMatch(/NEVER CUT THE SCENE OFF BEFORE HE ACTS/);
    expect(text).toMatch(/stops at "the officer broke it up" has been cleaned up/);
    expect(buildTwistBrief([])).toMatch(/including what he did, and what it cost/);
  });

  it('caps the pet words the model leans on', () => {
    expect(text).toMatch(/"calculation\/calculate" and "recognition\/recognize" may each appear at most three times/);
  });

  it('makes the supplied memory card the core of point 2', () => {
    expect(text).toMatch(/"MEMORY TO BUILD POINT 2 ON" block is supplied, that memory IS the core of point 2/);
  });

  it('keeps the closing order-lines from repeating one opening word', () => {
    expect(text).toMatch(/Never start two of these lines with the same word/);
    expect(text).toMatch(/not "Catch", not "Watch"/);
  });

  it('twist brief points at the moment his own thinking is on the page and keeps caveats silent', () => {
    const brief = buildTwistBrief([]);
    expect(brief).toMatch(/his OWN thinking is on the page/);
    expect(brief).toMatch(/silent fact-safety rule/);
  });
});

describe('unique persona: concrete reaction, no self-narrated caution', () => {
  const text = buildUniquePersona(false);
  it('shows a wrong and a right version of the raw reaction', () => {
    expect(text).toMatch(/CONCRETE spoken thought/);
    expect(text).toMatch(/WRONG: "The criminal mind starts searching/);
    expect(text).toMatch(/RIGHT: "First thing in my head: what did she say to him/);
  });
  it('turns a denied rumor into pressure instead of a spoken warning', () => {
    expect(text).toMatch(/A RUMOR OR A DENIED STORY IS PRESSURE, NOT A WARNING LABEL/);
    expect(text).toMatch(/WRONG: "Don't build a fight scene out of a disputed report\."/);
    expect(text).toMatch(/the story got there before he did/);
  });
  it('bans announcing what is not invented or not known', () => {
    expect(text).toMatch(/DON'T NARRATE YOUR OWN CAUTION/);
    expect(text).toMatch(/A man on camera does not read his own disclaimers/);
  });
});

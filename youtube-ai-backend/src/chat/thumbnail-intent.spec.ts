import {
  asksToMakeImage,
  claimsNoImages,
  hasConceptBlock,
  needsConceptRescue,
  scrubImageRefusals,
} from './thumbnail-intent';
import { findThumbnailProblems } from './thumbnail-health.service';
import { shouldAutoGenerateImages } from './chat.service';

/** The client's real messages that were answered with "I can't render images" (Oct 13 to Nov 25 2026). */
const REAL_ASKS = [
  'yes 40 Years to Life is the exact time is verified generate a thumbnail for that and this video that I just pasted is not about P',
  'generate a thumbnail for that that I just pasted in I\'ll paste it again.... WHEN FRIENDSHIP COMES WITH A PRICE',
  'generate me a thumbnail and here\'s a picture of the main character John Gotti',
  'generate the thumbnail using that image that I just put in the one about 50 Cent and his son and him going to court [Image uploaded: a.png]',
  'generate a thumbnail for this video with 50 Cent and tia Kemp Rick Ross baby mother I already uploaded their picture in here',
  'make me a generate me a thumbnail with little Dirk in court with prison uniform on to depict the video that we\'re doing now',
  'generate me a thumbnail for this video alive thumbnail but I\'m going to do a live on this video for yellow busy being found guilty',
  'generate the thumbnail to picture with the light skin guy with the corn braids that\'s yellow busy yella beezy',
  'generate me a thumbnail for this video man',
  'yes generate the image just the way you said it above',
  'generate thumbnail',
  'generate me a thumbnail for this yellow busy gets life without parole how do you live with no release date',
  'use this picture to make the thumbnail and make yellow busy with a bald head and in a prison jumpsuit orange jumpsuit [Image uploaded: Screenshot_2026-11-13_213025.png]',
  'generate thumbnail use that picture and the picture of his girlfriend that I\'m getting ready to put in [Image uploaded: b.png]',
];

/** The assistant replies the client got instead of images (copied from the saved Nov 25 chat). */
const REAL_REFUSALS = [
  'I can’t render the edited image directly in this chat, but here’s the exact edit instruction for your two uploaded pictures:',
  '**I can’t generate or attach the thumbnail here—the image-generation tool isn’t available.**\n\nThe requested edit is clear:',
  '**I can’t render or attach an image in this chat.** Use this production-ready edit prompt:',
  'Got it—this uploaded photo is the likeness reference.\n\nI can prepare the precise editing instructions here, but I can’t directly render the image in this chat.',
];

const BLOCK = 'Here you go.\n<!-- THUMBNAILS_START -->\n### Concept 1: A\n**Text overlay:** X\n### Concept 2 (Bold): B\n**Text overlay:** Y\n<!-- THUMBNAILS_END -->';

describe('what counts as the client asking for a picture', () => {
  it.each(REAL_ASKS)('"%s" is an ask to make an image', (text) => {
    expect(asksToMakeImage(text)).toBe(true);
  });

  it('does not treat questions, scripts or advice as an ask to draw', () => {
    for (const text of [
      'what makes a good thumbnail?',
      'write me a script about the Yella Beezy verdict',
      'make the script darker and harder',
      'give me ideas for tomorrow',
      'this is a picture of yellow busy',
      'should the thumbnail have text',
    ]) {
      expect(asksToMakeImage(text)).toBe(false);
    }
  });

  it('the page auto-generates for the short follow-ups that the router scored low', () => {
    // "yes generate the image just the way you said it above" scored 0.6 (follow-up fast path): below the gate
    expect(shouldAutoGenerateImages('thumbnail', 0.6, 'yes generate the image just the way you said it above')).toBe(true);
    expect(shouldAutoGenerateImages('general', 0.6, 'what makes a good opener?')).toBe(false);
  });
});

describe('replies that refuse to draw images', () => {
  it.each(REAL_REFUSALS)('is spotted: %s', (reply) => {
    expect(claimsNoImages(reply)).toBe(true);
  });

  it('is not triggered by normal concept replies or other chat', () => {
    expect(claimsNoImages(BLOCK)).toBe(false);
    expect(claimsNoImages('Yella Beezy got life without parole. Here is the angle for the live.')).toBe(false);
    expect(claimsNoImages('I cannot verify the NFL rumor, so keep it a question.')).toBe(false);
  });

  it('refusals in the history are not shown to the model again', () => {
    const history = [
      { role: 'user', content: 'generate thumbnail' },
      { role: 'assistant', content: REAL_REFUSALS[1] },
      { role: 'assistant', content: 'A normal reply' },
    ];
    const clean = scrubImageRefusals(history);
    expect(clean[0].content).toBe('generate thumbnail');
    expect(clean[1].content).not.toMatch(/isn’t available/);
    expect(clean[1].content).toMatch(/draws the thumbnail images automatically/);
    expect(clean[2].content).toBe('A normal reply');
  });
});

describe('when a reply must be rewritten so the images get drawn', () => {
  it('rewrites every real Nov 25 style refusal when the client asked to make a picture', () => {
    for (const ask of REAL_ASKS) {
      for (const reply of REAL_REFUSALS) {
        expect(needsConceptRescue({ explicitAsk: asksToMakeImage(ask), routedThumbnail: true, reply })).toBe(true);
      }
    }
  });

  it('rewrites a reply that refused even when the client only pasted the concept (router said thumbnail)', () => {
    expect(needsConceptRescue({ explicitAsk: false, routedThumbnail: true, reply: REAL_REFUSALS[2] })).toBe(true);
  });

  it('leaves a reply that already holds the concept block', () => {
    expect(needsConceptRescue({ explicitAsk: true, routedThumbnail: true, reply: BLOCK })).toBe(false);
    expect(hasConceptBlock(BLOCK)).toBe(true);
  });

  it('never draws (and pays for) an image nobody asked for', () => {
    // a theory question the router called "thumbnail": a plain answer is fine
    expect(
      needsConceptRescue({ explicitAsk: false, routedThumbnail: true, reply: 'Faces with direct eye contact tend to win the click.' }),
    ).toBe(false);
    expect(needsConceptRescue({ explicitAsk: false, routedThumbnail: false, reply: REAL_REFUSALS[0] })).toBe(false);
    // a long real answer (a script) that merely lacks the block is not a refusal
    expect(needsConceptRescue({ explicitAsk: true, routedThumbnail: false, reply: 'word '.repeat(600) })).toBe(false);
  });
});

describe('the daily check that finds a thumbnail ask that ended without its images', () => {
  const now = new Date('2026-11-26T18:00:00Z');
  const since = new Date('2026-11-25T16:00:00Z');
  const at = (iso: string) => new Date(iso);
  const concepts = '<!-- THUMBNAILS_START -->\n### Concept 1: A\n### Concept 2 (Bold): B\n<!-- THUMBNAILS_END -->';
  const img = (n: number) => ({ mode: 'thumbnail', url: `u${n}`, conceptTitle: `Concept ${n}` });

  it('flags the Nov 25 chat: a refusal, and a package that got one of two images', () => {
    const thread = {
      _id: 't1',
      messages: [
        { _id: 'm1', role: 'assistant', createdAt: at('2026-11-25T16:20:00Z'), content: concepts, metadata: { autoImages: true, images: [img(2)] } },
        { _id: 'm2', role: 'assistant', createdAt: at('2026-11-25T16:32:00Z'), content: REAL_REFUSALS[1], metadata: { category: 'thumbnail' } },
      ],
    };
    const problems = findThumbnailProblems([thread], now, since);
    expect(problems.map((p) => p.kind).sort()).toEqual(['images_missing', 'refused']);
  });

  it('is quiet when both images exist, when the missing one is saved as waiting for a photo, and while it is still generating', () => {
    const ok = { _id: 'a', role: 'assistant', createdAt: at('2026-11-25T16:20:00Z'), content: concepts, metadata: { autoImages: true, images: [img(1), img(2)] } };
    const waiting = { _id: 'b', role: 'assistant', createdAt: at('2026-11-25T17:20:00Z'), content: concepts, metadata: { autoImages: true, images: [img(2)], waitingPhotos: { concept_1: [{ name: 'Yella Beezy', role: 'x' }] } } };
    const fresh = { _id: 'c', role: 'assistant', createdAt: at('2026-11-26T17:50:00Z'), content: concepts, metadata: { autoImages: true, images: [] } };
    const manual = { _id: 'd', role: 'assistant', createdAt: at('2026-11-25T17:00:00Z'), content: concepts, metadata: { images: [] } };
    expect(findThumbnailProblems([{ _id: 't', messages: [ok, waiting, fresh, manual] }], now, since)).toEqual([]);
  });
});

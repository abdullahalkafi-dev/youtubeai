import { ThumbnailComposerService } from './thumbnail-composer.service';
const sharp = require('sharp');

/**
 * The headline used to be built from six WHITE copies (tint() keeps brightness), which fattened the
 * letters into unreadable blobs. These tests pin the fix: a real black outline, white letters,
 * every line inside its box.
 */
describe('studio headline lettering', () => {
  const composer = new ThumbnailComposerService();
  let grey: string;
  beforeAll(async () => {
    const image = await sharp({ create: { width: 1536, height: 864, channels: 3, background: '#808080' } }).png().toBuffer();
    grey = 'data:image/png;base64,' + image.toString('base64');
  });

  const count = async (buffer: Buffer, test: (r: number, g: number, b: number) => boolean) => {
    const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < data.length; i += info.channels) if (test(data[i], data[i + 1], data[i + 2])) n++;
    return n;
  };

  it('draws white letters with a real black outline (not white blobs)', async () => {
    const { buffer } = await composer.composeStudioThumbnail({
      backgroundInput: grey, text: 'TUPAC SHAKUR / KILLED AT JUST 25 / WHO WOULD HE BE TODAY?', textSide: 'left',
      aspectRatio: '16:9', excludeHost: true, excludeLogo: true,
    });
    const white = await count(buffer, (r, g, b) => r > 235 && g > 235 && b > 235);
    const black = await count(buffer, (r, g, b) => r < 30 && g < 30 && b < 30);
    const yellow = await count(buffer, (r, g, b) => r > 220 && g > 200 && b < 60);
    expect(white).toBeGreaterThan(8000);
    expect(black).toBeGreaterThan(8000);
    expect(yellow).toBeGreaterThan(3000);
  });

  it('keeps the letters inside the left text box and leaves the face side untouched', async () => {
    const { buffer, issues } = await composer.composeStudioThumbnail({
      backgroundInput: grey, text: 'TUPAC SHAKUR / KILLED AT JUST 25 / WHO WOULD HE BE TODAY?', textSide: 'left',
      aspectRatio: '16:9', excludeHost: true, excludeLogo: true,
    });
    expect(issues).toEqual([]);
    // Right half of the frame: still the plain grey background (no lettering, no shadow).
    // (sharp's stats() ignores extract(), so the region is turned into its own image first.)
    const rightHalf = await sharp(await sharp(buffer).extract({ left: 860, top: 0, width: 676, height: 864 }).removeAlpha().png().toBuffer()).stats();
    for (const channel of rightHalf.channels) {
      expect(channel.min).toBe(128);
      expect(channel.max).toBe(128);
    }
  });

  it('splits one very long line in two instead of shrinking it to a sliver, and keeps 9:16 at the top of its box', async () => {
    const wide = await composer.composeStudioThumbnail({
      backgroundInput: grey, text: 'DIDDY RUSHED TO HOSPITAL AFTER PRISON FIGHT', textSide: 'left', aspectRatio: '16:9', excludeHost: true, excludeLogo: true,
    });
    const rows = await sharp(wide.buffer).extract({ left: 0, top: 0, width: 800, height: 864 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    // Rows that contain yellow letters: two stacked lines means two separate bands.
    const bands: number[] = [];
    let inBand = false;
    for (let y = 0; y < rows.info.height; y++) {
      let has = false;
      for (let x = 0; x < rows.info.width && !has; x++) {
        const i = (y * rows.info.width + x) * rows.info.channels;
        has = rows.data[i] > 220 && rows.data[i + 1] > 200 && rows.data[i + 2] < 60;
      }
      if (has && !inBand) bands.push(y);
      inBand = has;
    }
    expect(bands.length).toBe(2);

    const tall = await composer.composeStudioThumbnail({
      backgroundInput: grey, text: 'A BIG STORY / TODAY', textSide: 'left', aspectRatio: '9:16', excludeHost: true, excludeLogo: true,
    });
    const info = await sharp(tall.buffer).metadata();
    expect([info.width, info.height]).toEqual([864, 1536]);
    // Nothing is drawn above the text box (top 55% of a vertical frame stays plain).
    const top = await sharp(await sharp(tall.buffer).extract({ left: 0, top: 0, width: 864, height: 840 }).removeAlpha().png().toBuffer()).stats();
    for (const channel of top.channels) expect(channel.max).toBe(128);
  });

  it('escapes markup characters and never throws on an odd headline', async () => {
    const { buffer } = await composer.composeStudioThumbnail({
      backgroundInput: grey, text: 'FAMILY & FREEDOM <WHY?> / "NEVER" HOME', textSide: 'left', aspectRatio: '16:9', excludeHost: true, excludeLogo: true,
    });
    expect((await sharp(buffer).metadata()).format).toBe('png');
  });
});

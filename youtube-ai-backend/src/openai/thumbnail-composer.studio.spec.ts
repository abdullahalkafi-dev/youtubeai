import { ThumbnailComposerService } from './thumbnail-composer.service';
const sharp = require('sharp');
describe('studio typography composition', () => {
  const composer = new ThumbnailComposerService();
  let background: string;
  beforeAll(async () => {
    const image = await sharp({
      create: { width: 1536, height: 864, channels: 3, background: '#4676a0' },
    })
      .png()
      .toBuffer();
    background = 'data:image/png;base64,' + image.toString('base64');
  });
  it.each(['16:9', '9:16'] as const)(
    'renders a long exact headline on %s with the bundled font',
    async (aspectRatio) => {
      const result = await composer.composeStudioThumbnail({
        backgroundInput: background,
        text: "HOW DO I TELL MY FAMILY\nI'M NEVER COMING HOME?",
        textSide: 'left',
        aspectRatio,
        excludeHost: true,
        excludeLogo: true,
      });
      const info = await sharp(result.buffer).metadata();
      expect([info.width, info.height]).toEqual(
        aspectRatio === '16:9' ? [1536, 864] : [864, 1536],
      );
      const stats = await sharp(result.buffer).stats();
      expect(
        stats.channels.some((channel: { stdev: number }) => channel.stdev > 10),
      ).toBe(true);
      expect(result.issues).toEqual([]);
    },
  );
  it('escapes markup and keeps a valid image for exact client text', async () => {
    const result = await composer.composeStudioThumbnail({
      backgroundInput: background,
      text: 'FAMILY & FREEDOM <WHY?>',
      textSide: 'right',
      aspectRatio: '16:9',
      excludeHost: true,
      excludeLogo: true,
      colors: 'red',
    });
    expect((await sharp(result.buffer).metadata()).format).toBe('png');
  });
  it('renders a tag chip and a disclosure label without breaking the layout', async () => {
    const plain = await composer.composeStudioThumbnail({
      backgroundInput: background,
      text: 'DIDDY RUSHED TO HOSPITAL',
      textSide: 'right',
      aspectRatio: '16:9',
      excludeHost: true,
      excludeLogo: true,
    });
    const labeled = await composer.composeStudioThumbnail({
      backgroundInput: background,
      text: 'DIDDY RUSHED TO HOSPITAL',
      textSide: 'right',
      aspectRatio: '16:9',
      excludeHost: true,
      excludeLogo: true,
      tag: 'Reported',
      label: 'Illustration',
    });
    expect(labeled.issues).toEqual([]);
    expect((await sharp(labeled.buffer).metadata()).width).toBe(1536);
    expect(Buffer.compare(plain.buffer, labeled.buffer)).not.toBe(0);
    // The red chip plate sits at the top-left corner of the right-hand text box.
    const patch = await sharp(labeled.buffer)
      .extract({ left: 748, top: 57, width: 8, height: 8 })
      .png()
      .toBuffer();
    const chip = await sharp(patch).stats();
    expect(chip.channels[0].mean).toBeGreaterThan(180);
    expect(chip.channels[2].mean).toBeLessThan(60);
  });
});

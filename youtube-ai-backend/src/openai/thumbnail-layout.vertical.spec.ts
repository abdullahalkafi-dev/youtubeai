import { layoutZones } from './thumbnail-layout';

/**
 * The composer pastes the logo and the host photo itself (ThumbnailComposerService
 * createLogoOverlay / createHostOverlay). The zones given to the image model must cover the
 * worst case of what the composer pastes, otherwise a face or the headline ends up underneath.
 */
describe('9:16 zones cover what the composer pastes', () => {
  const W = 864;
  const H = 1536;

  it('covers the widest logo in either top corner', () => {
    for (const side of ['top-left', 'top-right'] as const) {
      const zones = layoutZones({ aspectRatio: '9:16', logoPosition: side });
      const logoH = Math.round(H * 0.09);
      const maxLogoW = Math.round(W * 0.3);
      const marginX = Math.round(W * 0.04);
      const left = side === 'top-left' ? marginX : W - maxLogoW - marginX;
      const box = zones.logo!;
      expect(left / W * 100).toBeGreaterThanOrEqual(box.x - 0.5);
      expect(((left + maxLogoW) / W) * 100).toBeLessThanOrEqual(box.x + box.w + 0.5);
      expect(((Math.round(H * 0.025) + logoH) / H) * 100).toBeLessThanOrEqual(box.h);
    }
  });

  it('covers the widest host cutout in the bottom-right corner', () => {
    const zones = layoutZones({ aspectRatio: '9:16' });
    const hostW = Math.round(W * 0.45);
    const hostH = Math.round(H * 0.2);
    const left = W - hostW - Math.round(W * 0.03);
    const box = zones.host!;
    expect((left / W) * 100).toBeGreaterThanOrEqual(box.x);
    expect(((H - hostH - Math.round(H * 0.025)) / H) * 100).toBeGreaterThanOrEqual(box.y);
  });

  it('keeps the headline clear of the logo row', () => {
    const zones = layoutZones({ aspectRatio: '9:16', logoPosition: 'top-right' });
    expect(zones.headline.y).toBeGreaterThanOrEqual(zones.logo!.y + zones.logo!.h);
  });
});

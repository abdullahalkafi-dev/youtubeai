/**
 * Reserved areas of a thumbnail. The boxes are generous versions of where
 * ThumbnailComposerService pastes the logo (createLogoOverlay) and the host photo
 * (createHostOverlay), so an AI-rendered headline or face never ends up under them.
 * Values are percentages of the canvas (x/y from the top-left).
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface ThumbnailZones {
  logo?: Box;
  host?: Box;
  headline: Box;
  /** Where the main subject should sit so it does not fight the headline. */
  subjectSide: 'left' | 'right';
}

export function layoutZones(options: {
  aspectRatio?: '16:9' | '9:16';
  logoPosition?: 'top-left' | 'top-right' | 'none';
  excludeLogo?: boolean;
  excludeHost?: boolean;
}): ThumbnailZones {
  const vertical = options.aspectRatio === '9:16';
  const logoSide =
    options.excludeLogo || options.logoPosition === 'none'
      ? undefined
      : options.logoPosition === 'top-left'
        ? 'left'
        : 'right';
  const logo: Box | undefined = logoSide
    ? vertical
      ? { x: logoSide === 'left' ? 0 : 65, y: 0, w: 35, h: 15 }
      : { x: logoSide === 'left' ? 0 : 85, y: 0, w: 15, h: 27 }
    : undefined;
  // The host photo is always composited bottom-right.
  const host: Box | undefined = options.excludeHost
    ? undefined
    : vertical
      ? { x: 50, y: 74, w: 50, h: 26 }
      : { x: 70, y: 55, w: 30, h: 45 };

  if (vertical) {
    // Headline across the upper middle, under the logo row.
    return {
      logo,
      host,
      headline: { x: 5, y: logo ? 17 : 5, w: 90, h: 25 },
      subjectSide: 'left',
    };
  }
  // Landscape: the headline goes on the side away from the logo, upper part,
  // so it can never run into the logo corner or the host box.
  const headlineLeft = logoSide !== 'left';
  return {
    logo,
    host,
    headline: headlineLeft
      ? { x: 3, y: 5, w: 55, h: 50 }
      : { x: 27, y: logo ? 5 : 5, w: 56, h: 45 },
    subjectSide: headlineLeft ? 'right' : 'left',
  };
}

const describe = (box: Box) =>
  `${box.x}%–${box.x + box.w}% from the left, ${box.y}%–${box.y + box.h}% from the top`;

/** Plain prompt text describing the zones for an image model. */
export function zonePrompt(zones: ThumbnailZones, headline?: string): string {
  const lines: string[] = [];
  if (headline)
    lines.push(
      `- HEADLINE: render exactly "${headline}" (same words, same spelling, nothing added or removed) as bold, colorful, high-contrast 2D lettering placed ONLY inside the area ${describe(zones.headline)}. Make it large and readable on a phone.`,
    );
  lines.push(
    `- MAIN SUBJECT: place the main face on the ${zones.subjectSide} side, clear of the headline area.`,
  );
  if (zones.logo)
    lines.push(
      `- RESERVED CORNER (${describe(zones.logo)}): plain, low-detail background only. NO text, NO letters, NO faces, NO graphics here.`,
    );
  if (zones.host)
    lines.push(
      `- RESERVED CORNER (${describe(zones.host)}): plain, low-detail background only. NO text, NO letters, NO faces, NO people here.`,
    );
  return lines.join('\n');
}

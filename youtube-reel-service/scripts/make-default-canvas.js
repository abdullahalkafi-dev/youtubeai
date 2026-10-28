/**
 * Draws assets/templates/default/canvas.png (1080x1920, transparent video window) with sharp.
 *
 *   node scripts/make-default-canvas.js [outFile]
 *
 * Layout (client, 2026-10-28): bigger video window, the phone number as one small line instead of a huge block, and the line the
 * client asked for under the video: FULL VIDEO - CHECK DESCRIPTION. Everything in the bottom band stays above y=1530, because
 * YouTube Shorts draws its own title and subscribe button over the lowest part of the screen.
 * Keep the numbers below in step with template.json (window, headline, captions).
 */
const path = require('path');
const sharp = require('sharp');

const W = 1080, H = 1920;
const YELLOW = '#FFD400';
const WINDOW = { x: 0, y: 480, w: 1080, h: 890 };
const fonts = path.join(__dirname, '..', 'assets', 'fonts');
const anton = path.join(fonts, 'Anton-Regular.ttf');

const rect = (w, h, color) => sharp({ create: { width: w, height: h, channels: 4, background: color } }).png().toBuffer();
const text = (markup, font, size) => sharp({ text: { text: markup, font: `${font} ${size}`, fontfile: anton, rgba: true } }).png().toBuffer();

(async () => {
  const layers = [];
  // the video window: cut out of the black base
  layers.push({ input: await rect(WINDOW.w, WINDOW.h, '#ffffff'), left: WINDOW.x, top: WINDOW.y, blend: 'dest-out' });
  // yellow rules above and below the window
  layers.push({ input: await rect(W, 8, YELLOW), left: 0, top: WINDOW.y - 8 });
  layers.push({ input: await rect(W, 8, YELLOW), left: 0, top: WINDOW.y + WINDOW.h });

  // brand line, below YouTube's top icons
  const brand = await text(`<span foreground="${YELLOW}">UNIQUE MECCA AUDIO</span>`, 'Anton', 54);
  layers.push({ input: brand, left: Math.round((W - (await sharp(brand).metadata()).width) / 2), top: 120 });

  // the client's line: a drawn arrow, then FULL VIDEO - CHECK DESCRIPTION
  const full = await text(`<span foreground="${YELLOW}">FULL VIDEO - CHECK DESCRIPTION</span>`, 'Anton', 62);
  const fullMeta = await sharp(full).metadata();
  const arrowW = 54, gap = 22;
  const startX = Math.round((W - (arrowW + gap + fullMeta.width)) / 2);
  const rowTop = WINDOW.y + WINDOW.h + 34;
  const arrow = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${arrowW}" height="${arrowW}"><polygon points="4,2 ${arrowW - 2},${arrowW / 2} 4,${arrowW - 2}" fill="${YELLOW}"/></svg>`);
  layers.push({ input: arrow, left: startX, top: rowTop + Math.round((fullMeta.height - arrowW) / 2) });
  layers.push({ input: full, left: startX + arrowW + gap, top: rowTop });

  // phone number: one small line
  const phone = await text(`<span foreground="${YELLOW}">BOOK A CALL</span>  <span foreground="#FFFFFF">1-917-680-9091</span>`, 'Anton', 50);
  layers.push({ input: phone, left: Math.round((W - (await sharp(phone).metadata()).width) / 2), top: rowTop + fullMeta.height + 26 });

  const out = process.argv[2] || path.join(__dirname, '..', 'assets', 'templates', 'default', 'canvas.png');
  await sharp({ create: { width: W, height: H, channels: 4, background: '#000000' } }).composite(layers).png().toFile(out);
  console.log('wrote', out);
})();

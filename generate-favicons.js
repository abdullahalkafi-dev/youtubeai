const sharp = require('./youtube-ai-backend/node_modules/sharp');
const fs = require('fs');
const path = require('path');

async function generateFavicons() {
  const sourceLogo = path.join(__dirname, 'youtube-ai-backend', 'src', 'assets', 'logo', 'mae-logo.png');
  if (!fs.existsSync(sourceLogo)) {
    console.error('Source logo not found at:', sourceLogo);
    process.exit(1);
  }

  console.log('Generating Unique Mecca Audio Favicons from:', sourceLogo);

  // Targets
  const frontendApp = path.join(__dirname, 'youtube-ai-frontend', 'src', 'app');
  const frontendPublic = path.join(__dirname, 'youtube-ai-frontend', 'public');
  const backendLogoDir = path.join(__dirname, 'youtube-ai-backend', 'src', 'assets', 'logo');

  if (!fs.existsSync(frontendPublic)) fs.mkdirSync(frontendPublic, { recursive: true });

  // 1. Generate 32x32 standard favicon png & ico
  const buf32 = await sharp(sourceLogo)
    .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const buf16 = await sharp(sourceLogo)
    .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const buf48 = await sharp(sourceLogo)
    .resize(48, 48, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const buf180 = await sharp(sourceLogo)
    .resize(180, 180, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const buf192 = await sharp(sourceLogo)
    .resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const buf512 = await sharp(sourceLogo)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // Next.js App Router icons
  fs.writeFileSync(path.join(frontendApp, 'favicon.ico'), buf32);
  fs.writeFileSync(path.join(frontendApp, 'icon.png'), buf192);
  fs.writeFileSync(path.join(frontendApp, 'apple-icon.png'), buf180);

  // Frontend Public directory assets
  fs.writeFileSync(path.join(frontendPublic, 'favicon.ico'), buf32);
  fs.writeFileSync(path.join(frontendPublic, 'favicon.png'), buf32);
  fs.writeFileSync(path.join(frontendPublic, 'icon.png'), buf192);
  fs.writeFileSync(path.join(frontendPublic, 'icon-512.png'), buf512);
  fs.writeFileSync(path.join(frontendPublic, 'apple-touch-icon.png'), buf180);
  fs.writeFileSync(path.join(frontendPublic, 'logo.png'), buf512);

  // Backend logo directory
  fs.writeFileSync(path.join(backendLogoDir, 'favicon.ico'), buf32);

  console.log('✅ All Unique Mecca Audio favicon and icon assets generated successfully!');
}

generateFavicons().catch(err => {
  console.error('Error generating favicons:', err);
  process.exit(1);
});

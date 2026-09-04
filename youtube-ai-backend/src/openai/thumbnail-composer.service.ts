import { Injectable, Logger } from '@nestjs/common';
const sharp = require('sharp');
import * as fs from 'fs';
import * as path from 'path';

export interface OverlayOptions {
  input: Buffer | string;
  top?: number;
  left?: number;
}

export interface ComposeThumbnailOptions {
  backgroundInput: Buffer | string; // Buffer or image URL/path
  selectedHostImage?: string | 'none'; // Filename from unique_images e.g. "host_1.png", or 'none'
  hostPosition?: 'left' | 'right';
  hostImageBuffer?: Buffer;
  customHostBuffer?: Buffer;
  excludeHost?: boolean;
  logoPosition?: 'top-left' | 'top-right' | 'none';
  customLogoBuffer?: Buffer;
  excludeLogo?: boolean;
  aspectRatio?: '16:9' | '9:16';
  width?: number;
  height?: number;
}

@Injectable()
export class ThumbnailComposerService {
  private readonly logger = new Logger(ThumbnailComposerService.name);
  private readonly defaultWidth = 1536;
  private readonly defaultHeight = 1024;

  /**
   * Main composition entry point using Sharp.
   */
  async composeThumbnail(options: ComposeThumbnailOptions): Promise<Buffer> {
    // 1. Prepare Base Background Canvas
    let baseBuffer: Buffer | undefined;
    if (Buffer.isBuffer(options.backgroundInput)) {
      baseBuffer = options.backgroundInput;
    } else if (typeof options.backgroundInput === 'string' && options.backgroundInput.startsWith('data:image/')) {
      const base64Data = options.backgroundInput.replace(/^data:image\/\w+;base64,/, '');
      baseBuffer = Buffer.from(base64Data, 'base64');
    } else if (typeof options.backgroundInput === 'string' && options.backgroundInput.startsWith('/api/assets/')) {
      // Local runtime asset resolution (/api/assets/generated/..., /api/assets/unique-images/..., etc.)
      const rawRelPath = options.backgroundInput.replace(/^\/api\/assets\//, '');
      // Normalize folder names to match disk paths (unique-images -> unique_images, logos -> logo)
      const normalizedRelPath = rawRelPath
        .replace(/^unique-images\//, 'unique_images/')
        .replace(/^logos\//, 'logo/');

      const candidatePaths = [
        path.join(process.cwd(), 'src', 'assets', normalizedRelPath),
        path.join(process.cwd(), 'youtube-ai-backend', 'src', 'assets', normalizedRelPath),
        path.join(__dirname, '..', 'assets', normalizedRelPath),
        path.join(process.cwd(), 'src', 'assets', rawRelPath),
        path.join(process.cwd(), 'youtube-ai-backend', 'src', 'assets', rawRelPath),
        path.join(__dirname, '..', 'assets', rawRelPath),
      ];
      for (const cp of candidatePaths) {
        if (fs.existsSync(cp)) {
          baseBuffer = fs.readFileSync(cp);
          break;
        }
      }
      if (!baseBuffer) {
        try {
          const port = process.env.PORT || 3001;
          baseBuffer = await this.fetchBufferFromUrl(`http://localhost:${port}${options.backgroundInput}`);
        } catch (e: any) {
          this.logger.warn(`Failed to resolve local asset path ${options.backgroundInput}: ${e.message}`);
        }
      }
    } else if (typeof options.backgroundInput === 'string' && options.backgroundInput.startsWith('http')) {
      baseBuffer = await this.fetchBufferFromUrl(options.backgroundInput);
    } else if (typeof options.backgroundInput === 'string' && fs.existsSync(options.backgroundInput)) {
      baseBuffer = fs.readFileSync(options.backgroundInput);
    } else if (typeof options.backgroundInput === 'string' && options.backgroundInput.trim().length > 100) {
      const cleanB64 = options.backgroundInput.trim().replace(/^data:image\/\w+;base64,/, '');
      baseBuffer = Buffer.from(cleanB64, 'base64');
    }

    if (!baseBuffer) {
      // Fallback dark gradient canvas
      const fallbackW = options.width || (options.aspectRatio === '9:16' ? 1024 : 1536);
      const fallbackH = options.height || (options.aspectRatio === '9:16' ? 1536 : 1024);
      baseBuffer = await sharp({
        create: {
          width: fallbackW,
          height: fallbackH,
          channels: 4,
          background: { r: 15, g: 17, b: 23, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
    }

    // Inspect native input metadata to match dimensions dynamically without unnecessary downscaling
    let bgWidth = options.width;
    let bgHeight = options.height;
    try {
      const metadata = await sharp(baseBuffer).metadata();
      if (!bgWidth && metadata.width) bgWidth = metadata.width;
      if (!bgHeight && metadata.height) bgHeight = metadata.height;
    } catch { /* use fallbacks */ }

    const isVertical = Boolean(options.aspectRatio === '9:16' || (bgHeight && bgWidth && bgHeight > bgWidth));
    const width = bgWidth || (isVertical ? 1024 : this.defaultWidth);
    const height = bgHeight || (isVertical ? 1536 : this.defaultHeight);

    // Resize background to target resolution preserving aspect ratio
    let canvas = sharp(baseBuffer).resize(width, height, { fit: 'cover', position: 'north' });

    const compositeLayers: OverlayOptions[] = [];

    // 2. Process Host Photo (Preserve face 100% exact, no AI touch)
    const hostBuffer = await this.resolveHostBuffer(options);
    if (hostBuffer) {
      try {
        const hostLayers = await this.createHostOverlay(
          hostBuffer,
          width,
          height,
          isVertical,
          options.hostPosition || 'right',
        );
        compositeLayers.push(...hostLayers);
      } catch (err: any) {
        this.logger.warn(`Failed to composite host photo overlay: ${err.message}`);
      }
    }

    // 3. Process Logo (Preserve logo 100% exact, Top-Right / Top-Left)
    const logoPos = options.logoPosition || 'top-right';
    if (logoPos !== 'none' && !options.excludeLogo) {
      try {
        const logoBuffer = await this.resolveLogoBuffer(options);
        if (logoBuffer) {
          const logoOverlays = await this.createLogoOverlay(logoBuffer, logoPos, width, height, isVertical);
          if (logoOverlays && logoOverlays.length > 0) {
            compositeLayers.push(...logoOverlays);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Failed to composite logo overlay: ${err.message}`);
      }
    }

    // 4. Final Composite & Render Output Buffer
    return canvas.composite(compositeLayers).png().toBuffer();
  }

  public async fetchBufferFromUrl(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP error fetching background image: ${res.statusText}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private resolveAssetDir(subdir: string): string {
    const candidatePaths = [
      path.join(process.cwd(), 'src', 'assets', subdir),
      path.join(process.cwd(), 'youtube-ai-backend', 'src', 'assets', subdir),
      path.join(__dirname, '..', 'assets', subdir),
    ];

    for (const cp of candidatePaths) {
      if (fs.existsSync(cp)) {
        return cp;
      }
    }
    return candidatePaths[0];
  }

  private async resolveHostBuffer(options: ComposeThumbnailOptions): Promise<Buffer | null> {
    // 1. Strict guard: If host is explicitly excluded or marked 'none', return null immediately (ZERO fallback)
    if (options.excludeHost === true || options.selectedHostImage === 'none') {
      return null;
    }

    if (options.customHostBuffer) return options.customHostBuffer;
    if (options.hostImageBuffer) return options.hostImageBuffer;

    const uniqueDir = this.resolveAssetDir('unique_images');

    // 2. Specific selected image filename
    if (options.selectedHostImage && options.selectedHostImage !== 'default') {
      let filename = options.selectedHostImage;
      if (!filename.includes('.')) filename += '.png';
      const localPath = path.join(uniqueDir, filename);
      if (fs.existsSync(localPath)) {
        return fs.readFileSync(localPath);
      }
    }

    // 3. Fallback to default/first available host cutout if host is not excluded
    if (fs.existsSync(uniqueDir)) {
      const files = fs.readdirSync(uniqueDir).filter((f) => /\.(png|webp)$/i.test(f));
      if (files.length > 0) {
        return fs.readFileSync(path.join(uniqueDir, files[0]));
      }
    }

    return null;
  }

  private async resolveLogoBuffer(options: ComposeThumbnailOptions): Promise<Buffer | null> {
    // Strict guard: If logo is explicitly excluded or position is 'none', return null immediately
    if (options.excludeLogo === true || options.logoPosition === 'none') {
      return null;
    }

    if (options.customLogoBuffer) return options.customLogoBuffer;

    const logoDir = this.resolveAssetDir('logo');
    if (fs.existsSync(logoDir)) {
      const files = fs.readdirSync(logoDir).filter((f) => /\.(png|jpg|jpeg|svg|webp)$/i.test(f));
      if (files.length > 0) {
        return fs.readFileSync(path.join(logoDir, files[0]));
      }
    }
    return null;
  }

  private async createHostOverlay(
    hostBuffer: Buffer,
    canvasWidth: number,
    canvasHeight: number,
    isVertical = false,
    hostPosition: 'left' | 'right' = 'right',
  ): Promise<OverlayOptions[]> {
    // Scale host cutout proportionally as a percentage of thumbnail height
    // Landscape: ~38% height; Vertical Reels: ~22% height to avoid dominating screen
    const targetHeight = isVertical ? Math.round(canvasHeight * 0.22) : Math.round(canvasHeight * 0.38);
    const maxHostWidth = Math.round(canvasWidth * 0.45);

    const resizedHost = await sharp(hostBuffer)
      .resize({ height: targetHeight, width: maxHostWidth, fit: 'inside' })
      .toBuffer();

    const metadata = await sharp(resizedHost).metadata();
    const hostWidth = Math.min(metadata.width || Math.round(targetHeight * 0.8), canvasWidth);

    // Percentage-based margins
    const marginX = isVertical ? Math.round(canvasWidth * 0.04) : Math.round(canvasWidth * 0.02);
    // In vertical Reels, place host above the bottom 18% caption & audio disc zone
    const bottomClearance = isVertical ? Math.round(canvasHeight * 0.18) : 0;

    const left = hostPosition === 'left' ? marginX : Math.max(0, canvasWidth - hostWidth - marginX);
    const top = Math.max(0, canvasHeight - targetHeight - bottomClearance);

    // Dark gradient shadow backdrop scaled to canvas resolution with strict bounds clamping
    const padX = Math.round(canvasWidth * 0.03);
    const padY = Math.round(canvasHeight * 0.03);

    const shadowLeft = Math.max(0, left - padX);
    const shadowTop = Math.max(0, top - padY);
    const shadowWidth = Math.max(1, Math.min(hostWidth + padX * 2, canvasWidth - shadowLeft));
    const shadowHeight = Math.max(1, Math.min(targetHeight + padY * 2, canvasHeight - shadowTop));

    const shadowSvg = Buffer.from(`
      <svg width="${shadowWidth}" height="${shadowHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="halo" cx="50%" cy="85%" r="60%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.72"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="${shadowWidth}" height="${shadowHeight}" fill="url(#halo)"/>
      </svg>
    `);

    const shadowBuffer = await sharp(shadowSvg).png().toBuffer();

    return [
      { input: shadowBuffer, top: shadowTop, left: shadowLeft },
      { input: resizedHost, top, left },
    ];
  }

  private async createLogoOverlay(
    logoBuffer: Buffer,
    position: 'top-left' | 'top-right',
    canvasWidth: number,
    canvasHeight: number,
    isVertical = false,
  ): Promise<OverlayOptions[]> {
    // Dynamic percentage height: ~20% of landscape height (~205px on 1024), ~9% of vertical height (~138px on 1536)
    const logoHeight = isVertical ? Math.round(canvasHeight * 0.09) : Math.round(canvasHeight * 0.20);
    const maxLogoWidth = Math.round(canvasWidth * 0.30);

    const resizedLogo = await sharp(logoBuffer)
      .resize({ height: logoHeight, width: maxLogoWidth, fit: 'inside' })
      .toBuffer();

    const metadata = await sharp(resizedLogo).metadata();
    const logoWidth = Math.min(metadata.width || Math.round(logoHeight * 1.3), canvasWidth);

    const marginX = isVertical ? Math.round(canvasWidth * 0.04) : Math.round(canvasWidth * 0.02);
    const top = Math.round(canvasHeight * 0.025);
    const left = position === 'top-left' ? marginX : Math.max(0, canvasWidth - logoWidth - marginX);

    // Soft dark radial halo behind logo watermark with strict bounds clamping
    const pad = Math.round(canvasWidth * 0.03);
    const shadowLeft = Math.max(0, left - pad);
    const shadowTop = Math.max(0, top - pad);
    const shadowWidth = Math.max(1, Math.min(logoWidth + pad * 2, canvasWidth - shadowLeft));
    const shadowHeight = Math.max(1, Math.min(logoHeight + pad * 2, canvasHeight - shadowTop));

    const logoShadowSvg = Buffer.from(`
      <svg width="${shadowWidth}" height="${shadowHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="logohalo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.75"/>
            <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="${shadowWidth}" height="${shadowHeight}" fill="url(#logohalo)"/>
      </svg>
    `);

    const logoShadowBuffer = await sharp(logoShadowSvg).png().toBuffer();

    return [
      { input: logoShadowBuffer, top: shadowTop, left: shadowLeft },
      { input: resizedLogo, top, left },
    ];
  }
}

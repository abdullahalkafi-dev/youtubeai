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
  selectedHostImage?: string; // Filename from unique_images e.g. "host_1.png" or custom buffer/url
  hostImageBuffer?: Buffer;
  logoPosition?: 'top-left' | 'top-right' | 'none';
  customLogoBuffer?: Buffer;
  width?: number;
  height?: number;
}

@Injectable()
export class ThumbnailComposerService {
  private readonly logger = new Logger(ThumbnailComposerService.name);
  private readonly defaultWidth = 1280;
  private readonly defaultHeight = 720;

  /**
   * Main composition entry point using Sharp.
   */
  async composeThumbnail(options: ComposeThumbnailOptions): Promise<Buffer> {
    const width = options.width || this.defaultWidth;
    const height = options.height || this.defaultHeight;

    // 1. Prepare Base Background Canvas
    let baseBuffer: Buffer;
    if (Buffer.isBuffer(options.backgroundInput)) {
      baseBuffer = options.backgroundInput;
    } else if (typeof options.backgroundInput === 'string' && options.backgroundInput.startsWith('data:image/')) {
      const base64Data = options.backgroundInput.replace(/^data:image\/\w+;base64,/, '');
      baseBuffer = Buffer.from(base64Data, 'base64');
    } else if (typeof options.backgroundInput === 'string' && options.backgroundInput.startsWith('http')) {
      baseBuffer = await this.fetchBufferFromUrl(options.backgroundInput);
    } else if (typeof options.backgroundInput === 'string' && fs.existsSync(options.backgroundInput)) {
      baseBuffer = fs.readFileSync(options.backgroundInput);
    } else if (typeof options.backgroundInput === 'string' && options.backgroundInput.trim().length > 100) {
      const cleanB64 = options.backgroundInput.trim().replace(/^data:image\/\w+;base64,/, '');
      baseBuffer = Buffer.from(cleanB64, 'base64');
    } else {
      // Fallback dark gradient canvas
      baseBuffer = await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: { r: 15, g: 17, b: 23, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
    }

    // Resize background to exact 1280x720 standard YouTube thumbnail resolution
    let canvas = sharp(baseBuffer).resize(width, height, { fit: 'cover', position: 'center' });

    const compositeLayers: OverlayOptions[] = [];

    // 2. Process Host Photo (Preserve face 100% exact, no AI touch)
    const hostBuffer = await this.resolveHostBuffer(options);
    if (hostBuffer) {
      try {
        const hostLayers = await this.createHostOverlay(hostBuffer, width, height);
        compositeLayers.push(...hostLayers);
      } catch (err: any) {
        this.logger.warn(`Failed to composite host photo overlay: ${err.message}`);
      }
    }

    // 3. Process Logo (Preserve logo 100% exact, Top-Left / Top-Right)
    const logoPos = options.logoPosition || 'top-left';
    if (logoPos !== 'none') {
      try {
        const logoBuffer = await this.resolveLogoBuffer(options);
        if (logoBuffer) {
          const logoOverlays = await this.createLogoOverlay(logoBuffer, logoPos, width, height);
          if (logoOverlays && logoOverlays.length > 0) {
            compositeLayers.push(...logoOverlays);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Failed to composite logo overlay: ${err.message}`);
      }
    }

    // NOTE: 3D Typography is rendered directly by AI in Stage 1

    // 4. Final Composite & Render Output Buffer
    return canvas.composite(compositeLayers).png().toBuffer();
  }

  private async fetchBufferFromUrl(url: string): Promise<Buffer> {
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
    if (options.hostImageBuffer) return options.hostImageBuffer;

    const uniqueDir = this.resolveAssetDir('unique_images');

    if (options.selectedHostImage) {
      let filename = options.selectedHostImage;
      if (!filename.includes('.')) filename += '.png';
      const localPath = path.join(uniqueDir, filename);
      if (fs.existsSync(localPath)) {
        return fs.readFileSync(localPath);
      }
    }

    // Fallback to first host image in unique_images directory
    if (fs.existsSync(uniqueDir)) {
      const files = fs.readdirSync(uniqueDir).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
      if (files.length > 0) {
        return fs.readFileSync(path.join(uniqueDir, files[0]));
      }
    }
    return null;
  }

  private async resolveLogoBuffer(options: ComposeThumbnailOptions): Promise<Buffer | null> {
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
  ): Promise<OverlayOptions[]> {
    // Scale host cutout to ~38% of thumbnail height
    const targetHeight = Math.round(canvasHeight * 0.38);

    const resizedHost = await sharp(hostBuffer)
      .resize({ height: targetHeight, fit: 'contain' })
      .toBuffer();

    const metadata = await sharp(resizedHost).metadata();
    const hostWidth = metadata.width || 400;

    // Place host subject bottom-right with padding
    const left = Math.max(0, canvasWidth - hostWidth - 28);
    const top = canvasHeight - targetHeight;

    // Dark gradient shadow backdrop — fade from transparent (top) to near-black (bottom)
    // Provides crisp separation between host sticker and background scene
    const shadowWidth = hostWidth + 60;
    const shadowHeight = targetHeight + 40;
    const shadowLeft = Math.max(0, left - 30);
    const shadowTop = Math.max(0, top - 20);

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
  ): Promise<OverlayOptions[]> {
    // Standard logo height ~64px
    const logoHeight = 64;

    const resizedLogo = await sharp(logoBuffer)
      .resize({ height: logoHeight, fit: 'contain' })
      .toBuffer();

    const metadata = await sharp(resizedLogo).metadata();
    const logoWidth = metadata.width || 180;

    const top = 28;
    const left = position === 'top-left' ? 28 : Math.max(0, canvasWidth - logoWidth - 28);

    // Soft dark radial halo behind logo watermark to ensure readability over any background
    const shadowWidth = logoWidth + 40;
    const shadowHeight = logoHeight + 40;
    const shadowLeft = Math.max(0, left - 20);
    const shadowTop = Math.max(0, top - 20);

    const logoShadowSvg = Buffer.from(`
      <svg width="${shadowWidth}" height="${shadowHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="logohalo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#000000" stop-opacity="0.65"/>
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

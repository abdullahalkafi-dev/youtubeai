import { Injectable, NotFoundException } from '@nestjs/common';
import { MinioService } from '../minio/minio.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AssetsService {
  constructor(private readonly minioService: MinioService) {}

  async getUniqueImages() {
    const uniqueDir = path.join(process.cwd(), 'src', 'assets', 'unique_images');
    if (!fs.existsSync(uniqueDir)) return [];

    const files = fs.readdirSync(uniqueDir).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, '') || '0', 10);
      const numB = parseInt(b.replace(/\D/g, '') || '0', 10);
      return numA - numB;
    });

    return files.map((file) => ({
      id: file,
      filename: file,
      url: `/api/assets/unique-images/${file}`,
      title: `Host Photo ${file.replace(/\.[^/.]+$/, '').replace('host_', '#')}`,
    }));
  }

  async getLogos() {
    const logoDir = path.join(process.cwd(), 'src', 'assets', 'logo');
    if (!fs.existsSync(logoDir)) return [];

    const files = fs.readdirSync(logoDir).filter((f) => /\.(png|jpg|jpeg|svg|webp)$/i.test(f));

    return files.map((file) => ({
      id: file,
      filename: file,
      url: `/api/assets/logos/${file}`,
      title: file.replace(/[-_]/g, ' ').replace(/\.[^/.]+$/, '').toUpperCase(),
    }));
  }

  saveGeneratedImage(filename: string, buffer: Buffer): string {
    const dir = path.join(process.cwd(), 'src', 'assets', 'generated');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);
    return `/api/assets/generated/${filename}`;
  }

  getHostImageFile(filename: string): { filePath: string; contentType: string } {
    const uniqueDir = path.join(process.cwd(), 'src', 'assets', 'unique_images');
    const filePath = path.join(uniqueDir, filename);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Host image file ${filename} not found`);
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';
    return { filePath, contentType };
  }

  getLogoFile(filename: string): { filePath: string; contentType: string } {
    const logoDir = path.join(process.cwd(), 'src', 'assets', 'logo');
    const filePath = path.join(logoDir, filename);

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Logo file ${filename} not found`);
    }

    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : 'image/jpeg';
    return { filePath, contentType };
  }
}

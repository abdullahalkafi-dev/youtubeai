import { Controller, Get, Param, Req, Res, NotFoundException } from '@nestjs/common';
import { Request, Response } from 'express';
import { AssetsService } from './assets.service';
import { MinioService } from '../minio/minio.service';
import * as fs from 'fs';

@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assetsService: AssetsService,
    private readonly minioService: MinioService,
  ) {}

  @Get('unique-images')
  getUniqueImages() {
    return this.assetsService.getUniqueImages();
  }

  @Get('favicon.ico')
  getFavicon(@Res() res: Response) {
    const faviconPath = require('path').join(__dirname, 'logo', 'favicon.ico');
    if (fs.existsSync(faviconPath)) {
      res.setHeader('Content-Type', 'image/x-icon');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(faviconPath).pipe(res);
    }
    const logoPath = require('path').join(__dirname, 'logo', 'mae-logo.png');
    if (fs.existsSync(logoPath)) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(logoPath).pipe(res);
    }
    throw new NotFoundException('Favicon not found');
  }

  @Get('logos')
  getLogos() {
    return this.assetsService.getLogos();
  }

  @Get('unique-images/:filename')
  getUniqueImageFile(@Param('filename') filename: string, @Res() res: Response) {
    try {
      const { filePath, contentType } = this.assetsService.getHostImageFile(filename);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      fs.createReadStream(filePath).pipe(res);
    } catch {
      throw new NotFoundException(`Asset ${filename} not found`);
    }
  }

  @Get('logos/:filename')
  getLogoFile(@Param('filename') filename: string, @Res() res: Response) {
    try {
      const { filePath, contentType } = this.assetsService.getLogoFile(filename);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      fs.createReadStream(filePath).pipe(res);
    } catch {
      throw new NotFoundException(`Asset ${filename} not found`);
    }
  }

  @Get('generated/:filename')
  getGeneratedFile(@Param('filename') filename: string, @Res() res: Response) {
    const dir = require('path').join(process.cwd(), 'src', 'assets', 'generated');
    const filePath = require('path').join(dir, filename);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(`Generated thumbnail ${filename} not found`);
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  }

  @Get('minio/*')
  async getMinioFile(@Req() req: Request, @Res() res: Response) {
    const rawPath = req.url.replace(/^.*\/minio\//, '').split('?')[0];
    const objectKey = decodeURIComponent(rawPath);

    if (!objectKey || objectKey === req.url) {
      throw new NotFoundException('MinIO asset key missing');
    }

    try {
      const stream = await this.minioService.getFileStream(objectKey);
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      (stream as any).pipe(res);
    } catch (error: any) {
      throw new NotFoundException(`MinIO asset ${objectKey} not found`);
    }
  }
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfig, CONFIG } from '../config/config';
import { BUCKETS, StorageService } from '../storage/storage.service';
import { ensureDir } from './media';
import { parseTemplate, ReelTemplate } from './template';

export interface LoadedTemplate {
  template: ReelTemplate;
  canvasPath: string;
  etag: string;
}

/**
 * Templates live in the private MinIO bucket `reel-templates/{name}/` (template.json + canvas.png).
 * The repo ships a default; the operator replaces it with the client's design via the CLI.
 */
@Injectable()
export class TemplateStoreService {
  private readonly logger = new Logger(TemplateStoreService.name);

  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly storage: StorageService,
  ) {}

  async get(name = 'default'): Promise<LoadedTemplate> {
    const jsonKey = `${name}/template.json`;
    let stat = await this.storage.stat(BUCKETS.templates, jsonKey);
    if (!stat) {
      await this.seedFromRepo(name);
      stat = await this.storage.stat(BUCKETS.templates, jsonKey);
      if (!stat) throw new Error(`Template "${name}" not found`);
    }
    const canvasStat = await this.storage.stat(BUCKETS.templates, `${name}/canvas.png`);
    const etag = `${stat.etag}-${canvasStat?.etag ?? 'nocanvas'}`.replace(/[^a-zA-Z0-9-]/g, '');
    const dir = ensureDir(path.join(this.cfg.REEL_WORK_DIR, 'templates', name, etag));
    const jsonPath = path.join(dir, 'template.json');
    const canvasPath = path.join(dir, 'canvas.png');
    if (!fs.existsSync(jsonPath)) await this.storage.getFile(BUCKETS.templates, jsonKey, jsonPath);
    const template = parseTemplate(JSON.parse(fs.readFileSync(jsonPath, 'utf8')));
    if (!fs.existsSync(canvasPath)) await this.storage.getFile(BUCKETS.templates, `${name}/${template.canvas}`, canvasPath);
    return { template, canvasPath, etag };
  }

  /** Upload a template folder (template.json + canvas.png). Validates before replacing anything. */
  async upload(name: string, dir: string) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8'));
    const template = parseTemplate({ ...raw, name });
    const canvas = path.join(dir, template.canvas);
    if (!fs.existsSync(canvas)) throw new Error(`Canvas image ${canvas} not found`);
    await this.storage.putFile(BUCKETS.templates, `${name}/${template.canvas}`, canvas, 'image/png');
    await this.storage.putBuffer(BUCKETS.templates, `${name}/template.json`, JSON.stringify(template, null, 2), 'application/json');
    this.logger.log(`Template "${name}" uploaded`);
    return template;
  }

  private async seedFromRepo(name: string) {
    const dir = path.join(this.cfg.assetsDir, 'templates', name);
    if (!fs.existsSync(path.join(dir, 'template.json'))) return;
    this.logger.log(`Seeding template "${name}" from bundled assets`);
    await this.upload(name, dir);
  }
}

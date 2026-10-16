/* eslint-disable no-console */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CoreModule } from '../core.module';
import { loadConfig } from '../config/config';
import { RendererService } from '../pipeline/renderer.service';
import { parseTemplate } from '../pipeline/template';
import { TemplateStoreService } from '../pipeline/template-store.service';
import { YouTubeSessionService } from '../pipeline/youtube-session.service';
import { QueueService } from '../queue/queue.service';
import { DownloaderService } from '../pipeline/downloader.service';
import { AnalyzerService } from '../pipeline/analyzer.service';
import { ReelSource } from '../db/schemas/reel-source.schema';
import { ReelCampaign, ReelCampaignDocument } from '../db/schemas/reel-campaign.schema';
import { ensureDir } from '../pipeline/media';

/**
 * Operator CLI (run inside the reel-worker container):
 *   node dist/cli/reel-cli.js template:upload <dir> [name]
 *   node dist/cli/reel-cli.js cookies:import <cookies.txt>
 *   node dist/cli/reel-cli.js session:check
 *   node dist/cli/reel-cli.js transcript:repair <youtubeId|all> [--apply]   (fix transcripts stored with the old chunk-offset bug)
 *   node dist/cli/reel-cli.js source:import <youtubeId> <video.mp4>   (manual fallback when YouTube blocks downloads)
 *   node dist/cli/reel-cli.js campaign:create <channelId> <userId> <targetReels> "<brief>"
 *   node dist/cli/reel-cli.js campaign:status <campaignId>
 *   node dist/cli/reel-cli.js render:local <video.mp4> <start> <duration> "<headline>" <outDir> [templateDir]   (no DB needed)
 */
async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'render:local') return renderLocal(args);

  const app = await NestFactory.createApplicationContext(CoreModule, { logger: ['warn', 'error'] });
  try {
    switch (cmd) {
      case 'template:upload': {
        const [dir, name = 'default'] = args;
        const t = await app.get(TemplateStoreService).upload(name, path.resolve(dir));
        console.log(`Template "${name}" uploaded. Window: ${JSON.stringify(t.window)}. Re-render existing reels to apply it.`);
        break;
      }
      case 'cookies:import': {
        const text = fs.readFileSync(path.resolve(args[0]), 'utf8');
        console.log(JSON.stringify(await app.get(YouTubeSessionService).saveCookies(text)));
        break;
      }
      case 'session:check': {
        const s = await app.get(YouTubeSessionService).check();
        console.log(JSON.stringify({ status: s.status, lastError: s.lastError ?? null }));
        break;
      }
      case 'transcript:repair': {
        const apply = args.includes('--apply');
        const analyzer = app.get(AnalyzerService);
        const model = app.get<Model<any>>(getModelToken(ReelSource.name));
        const ids = args[0] === 'all' ? (await model.find({ transcriptReady: true }).select('youtubeId').lean()).map((s: any) => s.youtubeId) : [args[0]];
        for (const id of ids) console.log(JSON.stringify(await analyzer.repairTranscript(id, apply)));
        break;
      }
      case 'source:import': {
        const [youtubeId, file] = args;
        await app.get(DownloaderService).importFile(youtubeId, path.resolve(file));
        console.log(`Imported ${youtubeId}; analysis queued`);
        break;
      }
      case 'campaign:create': {
        const [channelId, userId, target, ...brief] = args;
        const model = app.get<Model<ReelCampaignDocument>>(getModelToken(ReelCampaign.name));
        const c = await model.create({
          channelId: new Types.ObjectId(channelId),
          userId: new Types.ObjectId(userId),
          name: brief.join(' ').slice(0, 80),
          brief: brief.join(' '),
          status: 'queued',
          settings: { targetReels: Number(target) || 3, minSec: 30, maxSec: 60, allowCrossVideo: true, templateName: 'default', seedVideoIds: [] },
          log: [{ at: new Date(), level: 'info', msg: 'Campaign created from CLI' }],
        });
        await app.get(QueueService).campaign('research', String(c._id));
        console.log(`Campaign ${c._id} queued`);
        break;
      }
      case 'campaign:status': {
        const model = app.get<Model<ReelCampaignDocument>>(getModelToken(ReelCampaign.name));
        const c = await model.findById(args[0]).lean();
        console.log(JSON.stringify({ status: c?.status, progress: c?.progress, usage: c?.usage, stats: c?.stats, log: (c?.log ?? []).slice(-15) }, null, 2));
        break;
      }
      default:
        console.log('Unknown command. See header of src/cli/reel-cli.ts');
    }
  } finally {
    await app.close();
  }
}

/** Render a test reel from a local file — verifies ffmpeg, fonts, template and captions without any services. */
async function renderLocal(args: string[]) {
  const [video, start, duration, headline, outDir, templateDir] = args;
  const cfg = loadConfig();
  const tplDir = path.resolve(templateDir ?? path.join(cfg.assetsDir, 'templates', 'default'));
  const template = parseTemplate(JSON.parse(fs.readFileSync(path.join(tplDir, 'template.json'), 'utf8')));
  const renderer = new RendererService(cfg, null as any, null as any, null as any, null as any, null as any, null as any, null as any);
  const dur = Number(duration);
  const sample = 'the first night inside nobody tells you the rules you learn them the hard way and that is the jewel'.split(' ');
  const words = sample.map((w, i) => ({ w, s: (i * dur) / sample.length, e: ((i + 0.85) * dur) / sample.length, eos: i === 8 || i === sample.length - 1 }));
  const dir = ensureDir(path.resolve(outDir));
  const res = await renderer.renderToDir({
    dir,
    clips: [{ src: path.resolve(video), start: Number(start), duration: dur }],
    words,
    headline,
    template,
    canvasPath: path.join(tplDir, template.canvas),
    expectedDuration: dur,
  });
  console.log(JSON.stringify(res, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

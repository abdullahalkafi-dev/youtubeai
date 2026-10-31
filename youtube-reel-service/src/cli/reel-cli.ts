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
import { ReelCampaign, ReelCampaignDocument, TERMINAL_CAMPAIGN_STATUSES } from '../db/schemas/reel-campaign.schema';
import { Reel, ReelDocument } from '../db/schemas/reel.schema';
import { ensureDir } from '../pipeline/media';
import { LanesService } from '../pipeline/lanes.service';
import { nyDate } from '../common/time';

/**
 * Operator CLI (run inside the reel-worker container):
 *   node dist/cli/reel-cli.js template:upload <dir> [name]
 *   node dist/cli/reel-cli.js cookies:import <cookies.txt>
 *   node dist/cli/reel-cli.js session:check
 *   node dist/cli/reel-cli.js transcript:repair <youtubeId|all> [--apply]   (fix transcripts stored with the old chunk-offset bug)
 *   node dist/cli/reel-cli.js render:retry-failed <sinceDate> [--apply]   (re-queue reels whose render failed, e.g. killed for memory)
 *   node dist/cli/reel-cli.js source:import <youtubeId> <video.mp4>   (manual fallback when YouTube blocks downloads)
 *   node dist/cli/reel-cli.js campaign:create <channelId> <userId> <targetReels> "<brief>"
 *   node dist/cli/reel-cli.js campaign:status <campaignId>
 *   node dist/cli/reel-cli.js render:refresh <sinceDate YYYY-MM-DD> [--apply]   (re-render the NOT-posted reels of campaigns created since that date, e.g. after a template change; dry run without --apply)
 *   node dist/cli/reel-cli.js lanes:preview <channelId>   (which videos the new-video and best-of-old lanes would use today; creates nothing)
 *   node dist/cli/reel-cli.js lanes:create <channelId> <userId>   (create today's new-video / best-of-old campaigns now, if they do not exist)
 *   node dist/cli/reel-cli.js uploads:check   (queue analysis of new uploads now)
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
      case 'lanes:preview': {
        const { pickBank, pickFresh } = await import('../pipeline/lanes');
        const cat = await app.get(LanesService).catalog(new Types.ObjectId(args[0]));
        const show = (v: any) => `${v.publishedAt?.toISOString().slice(0, 10)} ${String(v.views).padStart(7)} views, ${v.analyzed ? 'analyzed' : 'not analyzed'}, ${v.strongMoments} strong moments: ${v.title}`;
        console.log('videos:', cat.length, '| analyzed:', cat.filter((v) => v.analyzed).length);
        console.log('FRESH'); for (const v of pickFresh(cat, new Date(), 3)) console.log('  ' + show(v));
        console.log('BANK'); for (const v of pickBank(cat, new Date(), 3)) console.log('  ' + show(v));
        break;
      }
      case 'lanes:create': {
        const made = await app.get(LanesService).createForDay(new Types.ObjectId(args[0]), nyDate(), new Types.ObjectId(args[1]));
        console.log(JSON.stringify(made));
        break;
      }
      case 'uploads:check': {
        console.log('queued for analysis:', await app.get(LanesService).analyzeNewUploads(true));
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
      case 'render:refresh': {
        // Same effect as "Refresh look" in the app, for several campaigns at once. Only reels still in To-do are re-made:
        // posted/rejected/failed reels, published videos and finished campaigns' other data are never touched.
        const since = new Date(`${args[0] ?? ''}T00:00:00Z`);
        if (Number.isNaN(since.getTime())) throw new Error('Usage: render:refresh <sinceDate YYYY-MM-DD> [--apply]');
        const apply = args.includes('--apply');
        const campaigns = app.get<Model<ReelCampaignDocument>>(getModelToken(ReelCampaign.name));
        const reels = app.get<Model<ReelDocument>>(getModelToken(Reel.name));
        const queues = app.get(QueueService);
        const list = await campaigns.find({ createdAt: { $gte: since } }).sort({ createdAt: 1 }).lean();
        let total = 0;
        for (const c of list) {
          const todo = await reels.find({ campaignId: c._id, status: 'todo' }).select('_id').lean();
          if (!todo.length) continue;
          if (!TERMINAL_CAMPAIGN_STATUSES.includes(c.status)) {
            console.log(`skip  ${c.name} (${c.status}: still working)`);
            continue;
          }
          console.log(`${apply ? 'queue' : 'would queue'} ${todo.length} reel(s)  ${c.name}`);
          total += todo.length;
          if (!apply) continue;
          await campaigns.updateOne({ _id: c._id }, { $set: { status: 'rendering', finishedAt: null, cancelRequested: false, 'progress.stage': 'rendering', 'progress.message': `Refreshing ${todo.length} reels with the latest template` } });
          for (const r of todo) {
            await reels.updateOne({ _id: r._id }, { $set: { status: 'queued', error: null } });
            await queues.render(String(r._id));
          }
        }
        console.log(`${apply ? 'Queued' : 'Dry run:'} ${total} reel(s).${apply ? '' : ' Add --apply to re-render them.'}`);
        break;
      }
      case 'render:retry-failed': {
        // Re-queues reels whose render failed (for example killed for memory) since a date. Reels that were cancelled are left alone.
        const since = new Date(`${args[0] ?? ''}T00:00:00Z`);
        if (Number.isNaN(since.getTime())) throw new Error('Usage: render:retry-failed <sinceDate YYYY-MM-DD> [--apply]');
        const apply = args.includes('--apply');
        const reels = app.get<Model<ReelDocument>>(getModelToken(Reel.name));
        const campaigns = app.get<Model<ReelCampaignDocument>>(getModelToken(ReelCampaign.name));
        const queues = app.get(QueueService);
        const failed = await reels.find({ status: 'failed', error: { $ne: 'Campaign cancelled' }, updatedAt: { $gte: since } }).select('_id campaignId').lean();
        console.log(`${apply ? 'Queueing' : 'Would queue'} ${failed.length} failed reel(s).`);
        if (!apply) break;
        for (const campaignId of new Set(failed.map((r) => String(r.campaignId)))) {
          await campaigns.updateOne({ _id: campaignId }, { $set: { status: 'rendering', finishedAt: null, cancelRequested: false, 'progress.stage': 'rendering', 'progress.message': 'Retrying failed renders' } });
        }
        for (const r of failed) {
          await reels.updateOne({ _id: r._id }, { $set: { status: 'queued', error: null } });
          await queues.render(String(r._id));
        }
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
  const renderer = new RendererService(cfg,null as any, null as any, null as any, null as any, null as any, null as any, null as any, null as any, null);
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
    pace: renderer.pace(),
  });
  console.log(JSON.stringify(res, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

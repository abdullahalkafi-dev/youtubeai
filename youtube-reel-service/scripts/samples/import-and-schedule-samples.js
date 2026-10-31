/* eslint-disable no-console */
// One-off operator script (runs in the reel worker container): imports the three full-screen sample videos as normal reels and
// schedules them in the day's three slots through the system's own services, so the planner, the metrics and the first comment treat them like any other post.
//   node import-samples.js            -> dry run (writes nothing)
//   node import-samples.js --apply    -> creates the campaign, reels, posts and the day
require('reflect-metadata');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { NestFactory } = require('@nestjs/core');
const { getModelToken } = require('@nestjs/mongoose');
const { Types } = require('mongoose');

const APPLY = process.argv.includes('--apply');
const DATE = '2026-10-31'; // the New York day
const CHANNEL = '6a81e0e956c00363be7b404e';
const FORMAT = 'fullscreen-v1-test';

const fullVideoLine = (title, link) => `🎥 FULL VIDEO: "${String(title).replace(/["“”<>]/g, '').replace(/\s+/g, ' ').trim()}" → ${link}`;

const SAMPLES = [
  {
    file: '/work/samples/out/A_diddy_steel_door_v2.mp4', yt: 'sbKgqRe4Ass', start: 130.18, end: 159.4,
    hook: "Diddy's name can fool an arena, we know that.", payoff: "Your body has to stay right where it's at, while your money's out there moving through somebody else's hands.",
    entityNames: ['Diddy'], entitySlugs: ['diddy'], themes: ['fame vs confinement', 'prison psychology'], pillar: 'isolation-psychological-toll',
    pack: {
      headline: "DIDDY'S MONEY CAN'T OPEN THAT STEEL DOOR",
      title: "Diddy: The Steel Door His Money Can't Open",
      altTitles: ["Diddy's Name Can Fool an Arena. Can It Open This Door?", '26 Years Inside: What Money Cannot Buy Behind a Steel Door'],
      lines: ["Diddy's name can fool an arena. It cannot open a steel door.", 'I did 26 years inside: the door opens when another man decides, and your money stays outside.', 'Could you handle that silence? Tell me in the comments.'],
      tags: ['diddy', 'sean combs', 'diddy prison', 'diddy federal prison', 'diddy allenwood', 'diddy transfer', 'prison door', 'federal prison life', 'prison psychology', 'money cannot buy freedom', '26 years in prison', 'prison reality', 'diddy news', 'unique mecca audio', 'unique mecca audio nyc'],
      hashtags: ['#shorts', '#Diddy', '#FederalPrison', '#UniqueMeccaAudio'],
      pinnedComment: "Diddy's name can fool an arena. Do you think it can open that steel door?",
      summary: "Unique explains that Diddy's fame and money have no power behind a locked steel door, drawing on his 26 years in federal prison.",
    },
  },
  {
    file: '/work/samples/out/B_50cent_tshirt_v2.mp4', yt: 'zMgkKZaaOtk', start: 843.86, end: 876.2,
    hook: "King put 50's deceased mother on a t-shirt and pushed the disrespect further.", payoff: 'Trying to make grief part of the punchline.',
    entityNames: ['50 Cent', 'King Harris'], entitySlugs: ['50-cent', 'king-harris'], themes: ['family in beef', 'grief'], pillar: 'celebrity-public-controversies',
    pack: {
      headline: "50 CENT'S LATE MOTHER MADE A PUNCHLINE",
      title: "King Harris Reportedly Put 50 Cent's Late Mother on a T-Shirt",
      altTitles: ['50 Cent & King Harris: Grief Became a Punchline', "50 Cent's Mother on a T-Shirt: Where Is the Line?"],
      lines: ["King Harris reportedly put 50 Cent's late mother on a t-shirt, and the feud got uglier.", "I understand anger. I don't give anger a blank check, and making grief the punchline crosses a line.", 'Where is the line when family gets pulled into a feud? Tell me in the comments.'],
      tags: ['50 cent', 'king harris', 'tia kemp', 'tiny harris', 't.i.', '50 cent feud', '50 cent tia kemp', 'king harris t-shirt', 'hip hop beef', 'family and beef', 'celebrity feud', 'prison wisdom', 'unique mecca audio', 'unique mecca audio nyc'],
      hashtags: ['#shorts', '#50Cent', '#KingHarris', '#UniqueMeccaAudio'],
      pinnedComment: "Is putting someone's late mother in a beef ever okay, or is that where it stops?",
      summary: "Unique says reportedly turning 50 Cent's late mother into a t-shirt joke crossed a line, even if the anger behind it is understandable.",
    },
  },
  {
    file: '/work/samples/out/C_durk_mother_v2.mp4', yt: 'fnXoQOPPxSI', start: 802.1, end: 839.3,
    hook: 'I wanted my mommy.', payoff: 'Because I had to do that time by myself no matter how much pride I had.',
    entityNames: ['Lil Durk'], entitySlugs: ['lil-durk'], themes: ['pride', 'family'], pillar: 'family-separation-responsibility',
    pack: {
      headline: 'BEHIND ALL THAT HARDNESS I WANTED MY MOTHER',
      title: "Lil Durk's Judge: Why I Wanted My Mother More Than Pride",
      altTitles: ['Under All That Hardness, I Wanted My Mother', "Lil Durk & the Judge: Pride Can't Keep You Company"],
      lines: ['Lil Durk faces a judge. I faced mine, and under all that hardness I wanted my mother.', "I told my brother I needed nobody. I could refuse his company, but I couldn't refuse the judge's authority.", 'Who would you want next to you in that courtroom? Tell me in the comments.'],
      tags: ['lil durk', 'lil durk bail', 'lil durk judge', 'lil durk case', 'lil durk mother', 'federal court', 'courtroom', 'prison pride', 'pride and ego', 'family and prison', '26 years in prison', 'prison wisdom', 'unique mecca audio', 'unique mecca audio nyc'],
      hashtags: ['#shorts', '#LilDurk', '#Court', '#UniqueMeccaAudio'],
      pinnedComment: "When you're standing in front of a judge, who do you want next to you: your pride or your mother?",
      summary: "Unique recalls that under his hardness he wanted his mother before facing a judge, and says pride can send you in alone but never keeps you company after.",
    },
  },
];

(async () => {
  const { CoreModule } = require('/app/dist/core.module');
  const { StorageService, BUCKETS } = require('/app/dist/storage/storage.service');
  const { PublishService } = require('/app/dist/publishing/publish.service');
  const { Reel } = require('/app/dist/db/schemas/reel.schema');
  const { ReelCampaign } = require('/app/dist/db/schemas/reel-campaign.schema');
  const { ReelAutoDay } = require('/app/dist/db/schemas/reel-autopublish.schema');
  const { ReelMoment } = require('/app/dist/db/schemas/reel-moment.schema');
  const { SourceVideo } = require('/app/dist/db/schemas/shared.readonly');
  const { ReelTranscript } = require('/app/dist/db/schemas/reel-transcript.schema');
  const { jitterRunAt, assignRotation, MIN_LEAD_MIN, slowSlots, DEFAULT_SLOTS } = require('/app/dist/publishing/auto-plan');
  const { fullVideoLine: realFullVideoLine } = require('/app/dist/publishing/description');

  const app = await NestFactory.createApplicationContext(CoreModule, { logger: ['warn', 'error'] });
  try {
    const cid = new Types.ObjectId(CHANNEL);
    const storage = app.get(StorageService);
    const publish = app.get(PublishService);
    const reels = app.get(getModelToken(Reel.name));
    const campaigns = app.get(getModelToken(ReelCampaign.name));
    const days = app.get(getModelToken(ReelAutoDay.name));
    const moments = app.get(getModelToken(ReelMoment.name));
    const videos = app.get(getModelToken(SourceVideo.name));
    const transcripts = app.get(getModelToken(ReelTranscript.name));
    const channel = await campaigns.db.collection('channels').findOne({ _id: cid }, { projection: { userId: 1 } });
    if (!channel) throw new Error('channel not found');

    if (await days.findOne({ channelId: cid, date: DATE })) throw new Error(`The ${DATE} plan already exists; not touching it`);

    // facts: source video docs, transcript line numbers, video duration
    const prepared = [];
    for (const s of SAMPLES) {
      const v = await videos.findOne({ youtubeId: s.yt }).select('title').lean();
      const t = await transcripts.findOne({ youtubeId: s.yt }).select('lines').lean();
      if (!v || !t) throw new Error(`source data missing for ${s.yt}`);
      const startLine = Math.max(0, t.lines.findIndex((l) => l.e > s.start + 0.2));
      let endLine = startLine;
      t.lines.forEach((l, i) => { if (l.s < s.end - 0.2 && l.e <= s.end + 1) endLine = i; });
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', s.file], { encoding: 'utf8' });
      const duration = parseFloat(probe.stdout);
      if (!(duration > 5)) throw new Error(`cannot read ${s.file}`);
      const link = `https://youtu.be/${s.yt}?t=${Math.floor(s.start)}`;
      const description = [realFullVideoLine(v.title, link), '', ...s.pack.lines].join('\n');
      prepared.push({ ...s, videoDocId: String(v._id), sourceTitle: v.title, startLine, endLine, duration, size: fs.statSync(s.file).size, description });
    }

    // today's slow mode keeps three slots: 8 AM, 8 PM and 10 PM; the order is the planner's own random rotation
    const slots = slowSlots(DEFAULT_SLOTS);
    const seed = `${CHANNEL}:${DATE}:${FORMAT}`;
    const assigned = assignRotation(prepared, slots, seed);
    const times = [];
    const plan = assigned.sort((a, b) => a.slot.localeCompare(b.slot)).map(({ item, slot }) => {
      const runAt = jitterRunAt({ date: DATE, slot, seed: `${CHANNEL}:${DATE}:${slot}`, earliest: Date.now() + MIN_LEAD_MIN * 60_000, others: times });
      times.push(runAt.getTime());
      return { item, slot, runAt };
    });

    console.log(APPLY ? 'APPLY' : 'DRY RUN', DATE, 'slots', slots.join(', '));
    for (const { item, slot, runAt } of plan) {
      console.log(`\n[${slot}] ${runAt.toISOString()}  ${item.pack.title}  (${item.pack.title.length} chars)`);
      console.log(`  video ${item.file} ${item.duration.toFixed(1)}s ${(item.size / 1e6).toFixed(1)} MB, source ${item.yt} lines ${item.startLine}-${item.endLine}`);
      console.log('  ' + item.description.split('\n').join('\n  '));
      console.log(`  tags ${item.pack.tags.length} | first comment: ${item.pack.pinnedComment}`);
      if (item.pack.title.length > 70) throw new Error('title too long');
    }
    if (!APPLY) return;

    const campaign = await campaigns.create({
      channelId: cid, userId: channel.userId, origin: 'manual', track: 'fresh', status: 'completed',
      name: 'Full-screen format test (3 reels)',
      brief: 'Three reels in the proposed full-screen look (no AI images), posted in the normal daily slots to compare with the current look.',
      settings: { targetReels: 3, minSec: 25, maxSec: 60, allowCrossVideo: false, templateName: FORMAT, seedVideoIds: prepared.map((p) => p.yt) },
      progress: { stage: 'done', message: 'Imported finished videos' },
      log: [{ at: new Date(), level: 'info', msg: 'Imported by the operator for a format test' }],
    });

    const items = [];
    let n = 0;
    for (const { item, slot, runAt } of plan) {
      n++;
      const reel = await reels.create({
        campaignId: campaign._id, channelId: cid, index: n, status: 'todo', shape: 'single_take',
        concept: item.pack.title, hookText: item.hook, payoffText: item.payoff,
        clips: [{ youtubeId: item.yt, videoId: item.videoDocId, sourceTitle: item.sourceTitle, role: 'hook', startLine: item.startLine, endLine: item.endLine, start: item.start, end: item.end, text: item.hook }],
        durationSec: item.duration,
        packaging: { headline: item.pack.headline, title: item.pack.title, altTitles: item.pack.altTitles, description: item.description, tags: item.pack.tags, hashtags: item.pack.hashtags, pinnedComment: item.pack.pinnedComment, summary: item.pack.summary },
        entitySlugs: item.entitySlugs, entityNames: item.entityNames, themes: item.themes, pillar: item.pillar,
        templateName: FORMAT, thumbnails: [],
        qa: { loudnessLufs: -14.5, width: 1080, height: 1920, warnings: [] },
      });
      const key = `${CHANNEL}/${campaign._id}/${reel._id}/reel.mp4`;
      await storage.putFile(BUCKETS.reels, key, item.file, 'video/mp4');
      await reels.updateOne({ _id: reel._id }, { $set: { assets: { videoKey: key, sizeBytes: item.size } } });
      // the passages these reels use are marked used, so the daily pipeline does not cut the same ones again
      await moments.updateMany({ youtubeId: item.yt, start: { $lt: item.end }, end: { $gt: item.start } }, { $set: { status: 'used' }, $addToSet: { usedByReelIds: reel._id } });
      const post = await publish.createAutoPost(CHANNEL, String(channel.userId), String(reel._id), { runAt, slot, planDate: DATE, mode: 'rotation', privacy: 'public', track: 'fresh', score: null });
      items.push({ reelId: reel._id, postId: new Types.ObjectId(post.id), slot, runAt, score: null, track: 'fresh', title: item.pack.title });
      console.log(`created reel ${reel._id} post ${post.id} for ${slot}`);
    }
    await days.create({ channelId: cid, date: DATE, status: 'planned', mode: 'rotation', fillingAt: null, items, held: [] });
    console.log('day plan saved:', items.map((i) => `${i.slot} ${i.runAt.toISOString()}`).join(' | '));
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

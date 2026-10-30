// READ-ONLY (mongosh): builds the sample specs with word timings from the stored transcripts
const defs = [
  { id: 'A_diddy_steel_door', yt: 'sbKgqRe4Ass', start: 130.18, end: 159.4, w0: 257, w1: 336, headline: ["DIDDY'S MONEY CAN'T", 'OPEN THAT STEEL DOOR'], pic: { x: 690, y: 112, w: 1170, h: 698 }, uq: { x: 0, y: 60, w: 700, h: 790 } },
  { id: 'B_50cent_tshirt', yt: 'zMgkKZaaOtk', start: 843.86, end: 876.2, w0: 2013, w1: 2077, headline: ["50 CENT'S LATE MOTHER", 'MADE A PUNCHLINE'], pic: { x: 700, y: 112, w: 1160, h: 698 }, uq: { x: 0, y: 60, w: 700, h: 790 } },
  { id: 'C_durk_mother', yt: 'fnXoQOPPxSI', start: 802.1, end: 839.3, w0: 2192, w1: 2266, headline: ['BEHIND ALL THAT HARDNESS', 'I WANTED MY MOTHER'], pic: { x: 15, y: 140, w: 1075, h: 705 }, uq: { x: 1030, y: 100, w: 870, h: 750 } },
];
const out = defs.map(d => {
  const t = db.reel_transcripts.findOne({ youtubeId: d.yt });
  const words = t.words.slice(d.w0, d.w1 + 1).map(w => ({ w: w.w, s: +(w.s - d.start).toFixed(3), e: +(w.e - d.start).toFixed(3) }));
  return Object.assign({}, d, { words });
});
print(JSON.stringify(out));

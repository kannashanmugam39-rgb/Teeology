// Acceptance tests from spec section 9 (default preset unless stated).
const TE = require('../src/engine.js');
let pass = 0, fail = 0;
function eq(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}
function cfg(extra) { return Object.assign(TE.defaultConfig(), { T: 200, F: 160, par3Club: 160 }, extra || {}); }
function run(hole, ph, inp, c) {
  c = c || cfg();
  const strokes = TE.strokesOnHole(ph, hole.si, 18);
  const t = TE.holeTargets(hole, strokes, c);
  const r = TE.holeResult(hole, t, inp, c, TE.makeBaseline('21-28'));
  return { t, r, strokes };
}

// 1
let x = run({ par: 4, yards: 380, si: 10 }, 22, { tee: 'F', toZone: 2, entryYd: 90, entryLie: 'F', zoneShots: 3, putts: 2 });
eq('1 n', x.t.n, 2); eq('1 target', x.t.target, 5); eq('1 zoneT', x.t.zoneT, 2); eq('1 bT', x.t.bT, 3);
eq('1 ticks', [x.r.aTick, x.r.bTick], [true, true]); eq('1 score', x.r.score, 5); eq('1 pts', x.r.stableford, 2);

// 2
x = run({ par: 4, yards: 400, si: 2 }, 22, { tee: 'L', toZone: 3, zoneShots: 4 });
eq('2 strokes', x.strokes, 2); eq('2 target', x.t.target, 6); eq('2 zoneT', x.t.zoneT, 3); eq('2 bT', x.t.bT, 3);
eq('2 ticks', [x.r.aTick, x.r.bTick], [true, false]); eq('2 score', x.r.score, 7); eq('2 pts', x.r.stableford, 1); eq('2 leak', x.r.leakNeeded, true);

// 3 par-3 within reach (160 + 10 = 170)
x = run({ par: 3, yards: 150, si: 14 }, 22, { tee: 'M', toZone: 1, zoneShots: 3 });
eq('3 applies', x.t.par3Applies, true); eq('3 target', x.t.target, 4); eq('3 zoneT', x.t.zoneT, 1); eq('3 bT', x.t.bT, 3);
eq('3 ticks', [x.r.aTick, x.r.bTick], [false, true]); eq('3 score', x.r.score, 4); eq('3 pts', x.r.stableford, 2);

// 4 beyond reach
x = run({ par: 3, yards: 205, si: 14 }, 22, { tee: 'S', toZone: 1, entryYd: 40, entryLie: 'F', zoneShots: 3 });
eq('4 applies', x.t.par3Applies, false); eq('4 A', x.r.aTick, true);

// 5 PH 10 par 5 500 SI 15; T 240 F 190
x = run({ par: 5, yards: 500, si: 15 }, 10, { toZone: 3, zoneShots: 3 }, cfg({ T: 240, F: 190 }));
eq('5 strokes', x.strokes, 0); eq('5 aMin', x.t.aMin, 3); eq('5 target', x.t.target, 5); eq('5 bT', x.t.bT, 2); eq('5 zoneT', x.t.zoneT, 3);
eq('5 ticks', [x.r.aTick, x.r.bTick], [true, false]); eq('5 score', x.r.score, 6); eq('5 pts', x.r.stableford, 1);

// 6 PH 22 par 4 470 SI 6; T 180 F 150
x = run({ par: 4, yards: 470, si: 6 }, 22, { toZone: 3, zoneShots: 3 }, cfg({ T: 180, F: 150 }));
eq('6 n', x.t.n, 3); eq('6 target', x.t.target, 5); eq('6 aMin', x.t.aMin, 3); eq('6 bT', x.t.bT, 2); eq('6 zoneT', x.t.zoneT, 3);
eq('6 ticks', [x.r.aTick, x.r.bTick], [true, false]); eq('6 score', x.r.score, 6); eq('6 pts', x.r.stableford, 1);

// 7 PH +2 (= -2) par 4 380 SI 18; T 280 F 200
x = run({ par: 4, yards: 380, si: 18 }, -2, { toZone: 2, zoneShots: 1 }, cfg({ T: 280, F: 200 }));
eq('7 strokes', x.strokes, -1); eq('7 target', x.t.target, 3); eq('7 aMin', x.t.aMin, 2); eq('7 bT', x.t.bT, 2); eq('7 zoneT', x.t.zoneT, 2); eq('7 stretch', x.t.stretch, true);
eq('7 ticks', [x.r.aTick, x.r.bTick], [true, true]); eq('7 score', x.r.score, 3); eq('7 pts', x.r.stableford, 2);
// plus handicap gets strokes back only on highest SIs
eq('7 SI16 strokes', TE.strokesOnHole(-2, 16, 18), 0);

// 8 water: shots to zone 3 incl. penalty
x = run({ par: 4, yards: 380, si: 10 }, 22, { tee: 'F', toZone: 3, entryYd: 80, entryLie: 'F', zoneShots: 3, penalties: [{ code: 'W', strokes: 1, stage: 'A' }] });
eq('8 ticks', [x.r.aTick, x.r.bTick], [false, true]); eq('8 penA', x.r.penA, 1); eq('8 score', x.r.score, 6); eq('8 pts', x.r.stableford, 1); eq('8 leak', x.r.leakNeeded, true);

// 9 recovery not in zone
x = run({ par: 4, yards: 380, si: 10 }, 22, { tee: 'F', toZone: 3, entryYd: 60, entryLie: 'F', zoneShots: 3 });
eq('9 ticks', [x.r.aTick, x.r.bTick], [false, true]); eq('9 score', x.r.score, 6);

// 10 SG with illustrative baseline
const fake = { E: (d, lie) => (d === 60 && lie === 'F' ? 3.1 : 2), Etee: () => 5.0 };
{
  const c = cfg(); const t = TE.holeTargets({ par: 4, yards: 380, si: 10 }, 1, c);
  const r = TE.holeResult({ par: 4, yards: 380, si: 10 }, t, { toZone: 3, entryYd: 60, entryLie: 'F', zoneShots: 3 }, c, fake);
  eq('10 sgA', r.sgA, -1.1); eq('10 sgB', r.sgB, 0.1); eq('10 total', Math.round((r.sgA + r.sgB) * 10) / 10, -1);
}
// 11 holed from 120 yd with 2nd
{
  const c = cfg(); const t = TE.holeTargets({ par: 4, yards: 380, si: 10 }, 1, c);
  const r = TE.holeResult({ par: 4, yards: 380, si: 10 }, t, { toZone: 2, zoneShots: 0 }, c, fake);
  eq('11', [r.bTick, r.score, r.sgA, r.sgB], [true, 2, 3, 0]);
}
// 12 pick up after 4 shots, ball in zone (2 to zone at 90 yd fairway)
{
  const c = cfg(); const t = TE.holeTargets({ par: 4, yards: 380, si: 10 }, 1, c);
  const base = { E: () => 3.0, Etee: () => 5.0 };
  const r = TE.holeResult({ par: 4, yards: 380, si: 10 }, t, { pickup: true, pickupStage: 'B', toZone: 2, entryYd: 90, entryLie: 'F' }, c, base);
  eq('12', [r.score, r.adjusted, r.stableford], [null, 7, 0]);
  eq('12 sg', [r.sgA, r.sgB], [0, -2]); // A: 5-3-2=0; B: 3-(7-2)=-2
}
// 13 adaptive: A ticked 80% over 10 rounds (180 holes), no change in last 10
{
  const c = cfg(); const sig = TE.cfgSig(c);
  const rounds = Array.from({ length: 10 }, (_, i) => ({ cfgSig: sig, date: '2026-0' + (1) + '-' + (10 + i), computed: { summary: { stagePlayed: 18, aTicks: 14.4, bTicks: 10 } } }));
  const s = TE.adaptiveSuggestion(rounds, c, [], sig);
  eq('13 status', s.status, 'suggest'); eq('13 stage', s.suggestions[0].stage + s.suggestions[0].dir, 'Atighten');
  const s2 = TE.adaptiveSuggestion(rounds, c, [{ date: '2026-01-19' }], sig);
  eq('13 cooldown', s2.status, 'cooldown');
}
// 14 putts > zone shots flagged and round can't close
{
  const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1, yards: 380 }));
  const round = { holes, ph: 22, cfg: cfg(), bag: { T: 200, F: 160, par3Club: 160 }, entries: { 1: { toZone: 2, zoneShots: 2, putts: 3 } }, holesPlayed: '18', band: '21-28' };
  const comp = TE.computeRound(round);
  eq('14 blockers', TE.closeBlockers(comp).length, 1);
}
// Handicap: HI 21.4, slope 125, CR 70.1 par 71 → CH 22.77 → ×0.95 = 21.63 → PH 22
eq('PH', TE.playingHandicap(TE.courseHandicap(21.4, 125, 70.1, 71), 95), 22);
// paper card reproduction with reach off: 0/1/2 strokes
{
  const c = cfg({ reachAdj: false });
  const z = s => { const t = TE.holeTargets({ par: 4, yards: 380 }, s, c); return [t.zoneT, t.bT]; };
  eq('paper 0', z(0), [2, 2]); eq('paper 1', z(1), [2, 3]); eq('paper 2', z(2), [3, 3]);
}
// 9-hole SI ranking
eq('nine SI', TE.nineHoleSI([{ si: 7 }, { si: 1 }, { si: 15 }]), [2, 1, 3]);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

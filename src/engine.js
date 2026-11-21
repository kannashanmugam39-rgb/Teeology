// Teeology scoring engine — pure functions, no UI. Spec v2 sections 3, 5.3, 8.
// Works in the browser (window.TE) and in Node (module.exports).
(function (root) {
  'use strict';

  const BANDS = [
    { id: 'plus-5', name: 'Plus to 5', lo: -10, hi: 5.4 },
    { id: '6-12', name: '6–12', lo: 5.5, hi: 12.4 },
    { id: '13-20', name: '13–20', lo: 12.5, hi: 20.4 },
    { id: '21-28', name: '21–28', lo: 20.5, hi: 28.4 },
    { id: '29-36', name: '29–36', lo: 28.5, hi: 36.4 },
    { id: '37-54', name: '37–54', lo: 36.5, hi: 54 },
  ];

  // Section 5.1 starting presets (recommended defaults, to be tuned with real data).
  const BAND_PRESETS = {
    'plus-5': { zone: 150, basis: 'gross', bCeil: 3, par3Rule: 'green', focus: 'Approach proximity, birdie conversion', rec: 'Track prox from 100–150 yd and up-and-down %' },
    '6-12': { zone: 125, basis: 'net', bCeil: 3, par3Rule: 'green', focus: 'Doubles avoided, approach proximity', rec: 'Remove doubles: plan conservative lines on SI 1–6' },
    '13-20': { zone: 100, basis: 'net', bCeil: 3, par3Rule: 'greenOrNear', focus: 'Penalties, 3-putts', rec: 'Tee club that keeps the ball in play on tight holes' },
    '21-28': { zone: 100, basis: 'net', bCeil: 3, par3Rule: 'greenOrNear', focus: 'Penalties, chips, lag putting', rec: 'One reliable tee club; lag to within 3 ft' },
    '29-36': { zone: 75, basis: 'net', bCeil: 3, par3Rule: 'greenOrNear', focus: 'Solid contact, ball in play', rec: 'Shorter clubs off the tee; one go-to chip' },
    '37-54': { zone: 50, basis: 'net', bCeil: 3, par3Rule: 'reach', focus: 'Advancing the ball every shot', rec: 'Count shots that go forward; basic putting distance control' },
  };

  function bandFor(hi) {
    for (const b of BANDS) if (hi <= b.hi) return b.id;
    return '37-54';
  }

  // Default settings (section 4). Everything is a setting.
  function defaultConfig() {
    return {
      zone: 100,              // yd
      k: 2,                   // regulation shots below par to reach zone
      par5Zone: 3,            // par-5 zone target in shots (2 or 3)
      basis: 'net',           // net | gross
      offset: 0,              // target = par + strokes + offset
      bFloor: 2,
      bCeil: 3,
      reachAdj: true,
      stretchPolicy: 'keep',  // keep | raise
      par3Rule: 'greenOrNear',// green | greenOrNear | reach
      par3Margin: 10,
      nearYd: 10,
      allowance: 95,          // %
      leakThreshold: 0,       // over target by N; -1 = off
      leakMode: 'main+contrib',
      minSample: 10,
      rollingWindow: 10,
      entryMode: 'full',      // quick | full
      tightenAbove: 75,
      easeBelow: 40,
      evidenceRounds: 10,
      evidenceHoles: 100,
      cooldownRounds: 10,
      autoTighten: false,
      lies: [
        { code: 'F', name: 'Fairway', inZone: true },
        { code: 'R', name: 'Rough', inZone: true },
        { code: 'S', name: 'Greenside sand', inZone: true },
        { code: 'X', name: 'Fringe', inZone: true },
        { code: 'G', name: 'Green', inZone: true },
        { code: 'RC', name: 'Recovery', inZone: false },
      ],
      teeCodes: [
        { code: 'F', name: 'Fairway' }, { code: 'L', name: 'Left' }, { code: 'R', name: 'Right' },
        { code: 'S', name: 'Short / duffed' }, { code: 'P', name: 'Penalty' },
        { code: 'G', name: 'On green (par 3)' }, { code: 'N', name: 'Near green (par 3)' }, { code: 'M', name: 'Missed (par 3)' },
      ],
      penaltyCodes: [
        { code: 'OB', name: 'Out of bounds', strokes: 1 },
        { code: 'W', name: 'Water', strokes: 1 },
        { code: 'U', name: 'Unplayable', strokes: 1 },
        { code: 'L', name: 'Lost ball', strokes: 1 },
      ],
      leakCodes: [
        { code: 'T', name: 'Tee shot' }, { code: 'AP', name: 'Approach' }, { code: 'W', name: 'Wedge' },
        { code: 'C', name: 'Chip / bunker' }, { code: 'P', name: 'Putting' }, { code: 'D', name: 'Decision' },
        { code: 'M', name: 'Mental' },
      ],
      cues: [],
      customFields: [],       // {id, name, type: number|yesno|text}
      baselineBand: null,     // null = player's own band
    };
  }

  // ---------- helpers ----------
  const fmod = (a, n) => ((a % n) + n) % n;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const num = (x) => (x === '' || x === null || x === undefined || isNaN(+x) ? null : +x);

  // ---------- 3.2 Handicap ----------
  // Course handicap = HI × Slope/113 + (CR − Par). For 9 holes, half the HI with 9-hole CR/slope/par.
  function courseHandicap(hi, slope, cr, par, nineHoles) {
    const h = nineHoles ? hi / 2 : hi;
    return h * slope / 113 + (cr - par);
  }
  // WHS rounding (nearest, .5 rounds up toward +∞ in magnitude for positive values)
  function whsRound(x) { return x >= 0 ? Math.round(x) : -Math.round(-x); }
  function playingHandicap(ch, allowancePct) { return whsRound(ch * allowancePct / 100); }

  // Strokes on a hole: floor(PH/n) + [SI ≤ PH mod n]; mathematical floor/mod so plus handicaps give strokes back from the highest SI.
  function strokesOnHole(ph, si, n) {
    n = n || 18;
    return Math.floor(ph / n) + (si <= fmod(ph, n) ? 1 : 0);
  }

  // For a 9-hole round on an 18-hole card, rank the 18-hole SIs into 1–9.
  function nineHoleSI(holes) {
    const sorted = holes.map((h, i) => ({ i, si: h.si })).sort((a, b) => a.si - b.si);
    const out = new Array(holes.length);
    sorted.forEach((x, r) => { out[x.i] = r + 1; });
    return out;
  }

  // ---------- 3.3 Hole targets ----------
  function shotsToPoint(L, T, F, dist) {
    // shots needed to get from tee (length L) to within `dist` yd of the hole
    if (L - T <= dist) return 1;
    return 1 + Math.ceil((L - T - dist) / F);
  }

  function shotsNeeded(L, cfg, dist, layup) {
    const T = cfg.T, F = cfg.F;
    if (!L || !T || !F) return 0;
    if (layup && layup > cfg.zone) {
      // play to the lay-up point first, then one more shot into the zone
      return shotsToPoint(L, T, F, layup) + 1;
    }
    return shotsToPoint(L, T, F, cfg.zone);
  }

  // cfg is the effective (merged) config for this hole; bag gives T, F, par3Club.
  function holeTargets(hole, strokes, cfg) {
    const par = hole.par;
    const L = num(hole.yards) || 0;
    const offset = cfg.offset || 0;
    const netPar = par + strokes;
    let target = (cfg.basis === 'gross' ? par : netPar) + offset;
    let k = cfg.k;
    if (par === 5 && cfg.par5Zone === 2) k = Math.max(k, 3);
    const n = cfg.reachAdj ? shotsNeeded(L, cfg, cfg.zone, num(hole.layup)) : 0;
    const aMin = Math.max(1, par - k, n);
    const bT = clamp(target - aMin, cfg.bFloor, cfg.bCeil);
    let zoneT = target - bT;
    let stretch = false;
    if (zoneT < aMin) { zoneT = aMin; stretch = true; }
    if (stretch && cfg.stretchPolicy === 'raise') target = zoneT + bT;
    const p3Reach = (cfg.par3Club || 0) + (cfg.par3Margin || 0);
    const par3Applies = par === 3 && cfg.par3Rule !== 'reach' && L > 0 && L <= p3Reach;
    return { par, strokes, netPar, target, n, aMin, zoneT, bT, stretch, par3Applies, zone: cfg.zone };
  }

  // ---------- baseline E(d, lie) — ESTIMATED starter tables (spec 10 gap 1) ----------
  // Base table is for the 13–20 band; other bands scale strokes-beyond-one.
  const BASE_YD = [[5, 2.35], [10, 2.45], [20, 2.55], [30, 2.7], [50, 2.9], [75, 3.1], [100, 3.3], [125, 3.5], [150, 3.7], [175, 3.9], [200, 4.05], [250, 4.3], [300, 4.55], [350, 4.8], [400, 5.05], [450, 5.35], [500, 5.65], [550, 5.95], [600, 6.3], [700, 7.0]];
  const BASE_FT = [[1, 1.0], [2, 1.05], [4, 1.25], [6, 1.45], [8, 1.6], [10, 1.7], [15, 1.85], [20, 1.95], [30, 2.1], [40, 2.2], [60, 2.35], [90, 2.55], [120, 2.7]];
  const LIE_ADJ = { F: 0, R: 0.2, S: 0.4, X: -0.05, RC: 0.6, T: 0 };
  const BAND_MULT = { 'plus-5': 0.82, '6-12': 0.91, '13-20': 1.0, '21-28': 1.08, '29-36': 1.17, '37-54': 1.3 };

  function interp(tbl, x) {
    if (x <= tbl[0][0]) return tbl[0][1];
    for (let i = 1; i < tbl.length; i++) {
      if (x <= tbl[i][0]) {
        const [x0, y0] = tbl[i - 1], [x1, y1] = tbl[i];
        return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      }
    }
    const [x0, y0] = tbl[tbl.length - 2], [x1, y1] = tbl[tbl.length - 1];
    return y1 + (y1 - y0) * (x - x1) / (x1 - x0);
  }

  function makeBaseline(band, custom) {
    if (custom && typeof custom.E === 'function') return custom;
    const m = BAND_MULT[band] || 1;
    const scale = (e) => 1 + (e - 1) * m;
    return {
      band, estimated: true,
      // d in yards, except lie 'G' where d is feet
      E(d, lie) {
        if (d === 0) return 0;
        if (lie === 'G') return scale(interp(BASE_FT, d));
        return scale(interp(BASE_YD, d) + (LIE_ADJ[lie] || 0));
      },
      Etee(L) { return scale(interp(BASE_YD, L)); },
    };
  }

  // ---------- 3.4 / 3.5 Results per hole ----------
  // inp: {tee, toZone, zoneShots, putts, entryYd, entryLie, firstPuttFt, prox, penalties:[{code,strokes,stage}], pickup, pickupStage, leak, leak2, commit}
  function holeResult(hole, t, inp, cfg, baseline) {
    const r = { flags: [], complete: false };
    const a = num(inp.toZone), b = num(inp.zoneShots), putts = num(inp.putts);
    const pens = inp.penalties || [];
    r.penA = pens.filter(p => p.stage === 'A').length;
    r.penB = pens.filter(p => p.stage === 'B').length;
    r.penStrokes = pens.reduce((s, p) => s + (num(p.strokes) || 0), 0);
    if (inp.pickup) {
      r.complete = true; r.pickup = true; r.score = null;
      r.adjusted = t.netPar + 2; r.stableford = 0;
      r.aTick = null; r.bTick = null;
      r.overTarget = true; r.leakNeeded = true;
      // SG uses adjusted score; extra strokes go to the stage the ball was in
      if (baseline && L(hole)) {
        const Et = baseline.Etee(L(hole));
        r.Etee = Et;
        const stage = inp.pickupStage || (a !== null ? 'B' : 'A');
        if (stage === 'B' && a !== null && inp.entryYd !== undefined && num(entryDist(inp)) !== null) {
          const Ee = baseline.E(num(entryDist(inp)), inp.entryLie || 'F');
          const bAdj = r.adjusted - a;
          r.sgA = Et - Ee - a; r.sgB = Ee - bAdj;
        } else if (stage === 'A') {
          r.sgA = Et - r.adjusted; r.sgB = 0;
        }
      }
      return r;
    }
    if (a === null || b === null) return r;
    r.complete = true;
    r.score = a + b;
    if (putts !== null && putts > b) r.flags.push('Putts are more than zone shots');
    if (putts !== null && b === 0 && putts > 0) r.flags.push('Holed from outside the zone cannot have putts');
    // A tick
    if (t.par3Applies) {
      const allowed = cfg.par3Rule === 'green' ? ['G'] : ['G', 'N'];
      r.aTick = allowed.includes(inp.tee) && a <= t.zoneT;
      if (!inp.tee) r.flags.push('Par-3 rule: choose the tee result (G / N / M)');
    } else {
      r.aTick = a <= t.zoneT;
    }
    r.bTick = b <= t.bT;
    r.stableford = Math.max(0, 2 + t.netPar - r.score);
    r.adjusted = Math.min(r.score, t.netPar + 2);
    r.vsA = a - t.zoneT; r.vsB = b - t.bT;
    r.vsTarget = r.score - t.target;
    r.vsNetPar = r.score - t.netPar;
    r.netDouble = r.score >= t.netPar + 2;
    r.threePutt = putts !== null && putts >= 3;
    r.overTarget = cfg.leakThreshold >= 0 && r.score > t.target + cfg.leakThreshold;
    r.leakNeeded = r.overTarget;
    // Strokes gained
    const ed = entryDist(inp);
    if (baseline && L(hole)) {
      const Et = baseline.Etee(L(hole));
      r.Etee = Et;
      if (b === 0) { r.sgA = Et - r.score; r.sgB = 0; }
      else if (num(ed) !== null) {
        const Ee = baseline.E(num(ed), inp.entryLie || 'F');
        r.Eentry = Ee;
        r.sgA = Et - Ee - a; r.sgB = Ee - b;
      }
    }
    if (r.sgA !== undefined) {
      r.sgA = Math.round(r.sgA * 100) / 100; r.sgB = Math.round(r.sgB * 100) / 100;
      r.worstStage = r.sgA <= r.sgB ? 'A' : 'B';
    } else {
      r.worstStage = (r.vsA - (r.vsB || 0)) >= 0 && r.vsA > 0 ? 'A' : (r.vsB > 0 ? 'B' : 'A');
    }
    return r;
  }
  function L(hole) { return num(hole.yards); }
  function entryDist(inp) {
    // on the green, entry distance is the first putt in feet
    if (inp.entryLie === 'G') return num(inp.firstPuttFt) !== null ? inp.firstPuttFt : inp.entryFt;
    return inp.entryYd;
  }

  // ---------- Round computation ----------
  // round: {holes:[{n,par,si,yards,layup}], ph, cfg (snapshot), bag, entries:{n: inp}, overrides:{n:{zone,offset,layup,reachAdj}}, holesPlayed:'18'|'F9'|'B9'}
  function effectiveCfg(round, n) {
    const ov = (round.overrides && round.overrides[n]) || {};
    const c = Object.assign({}, round.cfg, round.bag || {});
    for (const k of ['zone', 'offset', 'reachAdj', 'k', 'par5Zone']) if (ov[k] !== undefined && ov[k] !== '' && ov[k] !== null) c[k] = ov[k];
    return c;
  }

  function roundHoles(round) {
    const all = round.holes;
    if (round.holesPlayed === 'F9') return all.slice(0, 9);
    if (round.holesPlayed === 'B9') return all.slice(9, 18);
    return all;
  }

  function computeRound(round) {
    const holes = roundHoles(round);
    const nine = holes.length === 9;
    const si9 = nine ? nineHoleSI(holes) : null;
    const baseline = makeBaseline(round.baselineBand || round.band || '13-20', round.customBaseline);
    const out = holes.map((h, i) => {
      const cfg = effectiveCfg(round, h.n);
      const ov = (round.overrides && round.overrides[h.n]) || {};
      const hole = Object.assign({}, h, ov.layup ? { layup: ov.layup } : {});
      const si = nine ? si9[i] : h.si;
      const strokes = strokesOnHole(round.ph, si, nine ? 9 : 18);
      const t = holeTargets(hole, strokes, cfg);
      const inp = (round.entries && round.entries[h.n]) || {};
      const r = holeResult(hole, t, inp, cfg, baseline);
      return { hole: h, t, r, inp, cfg };
    });
    return { holes: out, summary: summarise(out, round) };
  }

  function summarise(rows, round) {
    const done = rows.filter(x => x.r.complete);
    const played = done.filter(x => !x.r.pickup);
    const s = {};
    s.holesDone = done.length; s.holesTotal = rows.length;
    s.gross = done.reduce((t, x) => t + (x.r.pickup ? x.r.adjusted : x.r.score), 0);
    s.hasNR = done.some(x => x.r.pickup);
    s.adjusted = done.reduce((t, x) => t + x.r.adjusted, 0);
    s.netPar = done.reduce((t, x) => t + x.t.netPar, 0);
    s.par = done.reduce((t, x) => t + x.t.par, 0);
    s.target = done.reduce((t, x) => t + x.t.target, 0);
    s.net = s.gross - (round.ph || 0) * (done.length / Math.max(rows.length, 1));
    s.netExact = done.length === rows.length;
    s.stableford = done.reduce((t, x) => t + (x.r.stableford || 0), 0);
    s.aTicks = played.filter(x => x.r.aTick).length;
    s.bTicks = played.filter(x => x.r.bTick).length;
    s.stagePlayed = played.length;
    s.penalties = done.reduce((t, x) => t + (x.inp.penalties || []).length, 0);
    s.penStrokes = done.reduce((t, x) => t + (x.r.penStrokes || 0), 0);
    s.netDoubles = done.filter(x => x.r.pickup || x.r.netDouble).length;
    s.threePutts = played.filter(x => x.r.threePutt).length;
    s.stretch = rows.filter(x => x.t.stretch).length;
    const entries = played.filter(x => x.inp.entryLie && x.inp.entryLie !== 'G' && num(x.inp.entryYd) !== null);
    s.avgEntry = entries.length ? entries.reduce((t, x) => t + +x.inp.entryYd, 0) / entries.length : null;
    s.nEntry = entries.length;
    const prox = played.filter(x => num(x.inp.prox) !== null);
    s.avgProx = prox.length ? prox.reduce((t, x) => t + +x.inp.prox, 0) / prox.length : null;
    s.nProx = prox.length;
    const offGreen = played.filter(x => x.inp.entryLie && x.inp.entryLie !== 'G' && +x.inp.zoneShots > 0);
    s.upDownN = offGreen.length;
    s.upDown = offGreen.filter(x => +x.inp.zoneShots <= 2).length;
    const sg = done.filter(x => x.r.sgA !== undefined);
    s.sgN = sg.length;
    s.sgA = sg.reduce((t, x) => t + x.r.sgA, 0);
    s.sgB = sg.reduce((t, x) => t + x.r.sgB, 0);
    s.vsA = played.reduce((t, x) => t + Math.max(0, x.r.vsA), 0);
    s.vsB = played.reduce((t, x) => t + Math.max(0, x.r.vsB), 0);
    s.vsNetPar = done.reduce((t, x) => t + ((x.r.pickup ? x.r.adjusted : x.r.score) - x.t.netPar), 0);
    const leaks = {};
    done.forEach(x => {
      if (x.inp.leak) { leaks[x.inp.leak] = leaks[x.inp.leak] || { n: 0, sg: 0, contrib: 0 }; leaks[x.inp.leak].n++; leaks[x.inp.leak].sg += Math.min(0, (x.r.sgA ?? 0) + (x.r.sgB ?? 0)); }
      if (x.inp.leak2) { leaks[x.inp.leak2] = leaks[x.inp.leak2] || { n: 0, sg: 0, contrib: 0 }; leaks[x.inp.leak2].contrib++; }
    });
    s.leaks = leaks;
    s.topLeaks = Object.entries(leaks).sort((a, b) => (b[1].n - a[1].n) || (a[1].sg - b[1].sg)).slice(0, 2).map(e => e[0]);
    const commits = done.filter(x => x.inp.commit === true || x.inp.commit === false);
    s.commitN = commits.length; s.commitYes = commits.filter(x => x.inp.commit === true).length;
    s.flags = rows.filter(x => x.r.flags && x.r.flags.length).map(x => ({ n: x.hole.n, flags: x.r.flags }));
    s.leakMissing = done.filter(x => x.r.leakNeeded && !x.inp.leak).map(x => x.hole.n);
    s.pensByCode = {};
    done.forEach(x => (x.inp.penalties || []).forEach(p => { s.pensByCode[p.code] = (s.pensByCode[p.code] || 0) + 1; }));
    return s;
  }

  // Can a round be closed? (test case 14)
  function closeBlockers(computed) {
    const b = [];
    computed.holes.forEach(x => { if (x.r.flags && x.r.flags.some(f => f.startsWith('Putts'))) b.push(`Hole ${x.hole.n}: putts are more than zone shots`); });
    return b;
  }

  // ---------- 5.3 Adaptive targets ----------
  // rounds: closed, individual-format rounds, newest last, each {cfgSig, computed, date, id}
  function adaptiveSuggestion(rounds, cfg, changeLog, currentSig) {
    const same = rounds.filter(r => r.cfgSig === currentSig);
    const recent = same.slice(-cfg.evidenceRounds);
    const holes = recent.reduce((t, r) => t + r.computed.summary.stagePlayed, 0);
    const lastChangeIdx = (() => {
      if (!changeLog || !changeLog.length) return -1;
      const last = changeLog[changeLog.length - 1].date;
      return rounds.findIndex(r => r.date > last) - 1;
    })();
    const roundsSinceChange = changeLog && changeLog.length ? rounds.filter(r => r.date > changeLog[changeLog.length - 1].date).length : Infinity;
    const res = { rounds: recent.length, holes, cooldownLeft: Math.max(0, cfg.cooldownRounds - (roundsSinceChange === Infinity ? cfg.cooldownRounds : roundsSinceChange)) };
    if (recent.length < cfg.evidenceRounds || holes < cfg.evidenceHoles) { res.status = 'collecting'; return res; }
    if (res.cooldownLeft > 0) { res.status = 'cooldown'; return res; }
    const aPct = 100 * recent.reduce((t, r) => t + r.computed.summary.aTicks, 0) / holes;
    const bPct = 100 * recent.reduce((t, r) => t + r.computed.summary.bTicks, 0) / holes;
    res.aPct = aPct; res.bPct = bPct;
    const sugg = [];
    if (aPct > cfg.tightenAbove) sugg.push({ stage: 'A', dir: 'tighten', change: { zone: Math.max(20, cfg.zone - 25) }, text: `Stage A ticked on ${aPct.toFixed(0)}% of ${holes} holes. Tighten: zone ${cfg.zone} → ${Math.max(20, cfg.zone - 25)} yd.` });
    else if (aPct < cfg.easeBelow) sugg.push({ stage: 'A', dir: 'ease', change: { zone: cfg.zone + 25 }, text: `Stage A ticked on only ${aPct.toFixed(0)}% of ${holes} holes. Ease: zone ${cfg.zone} → ${cfg.zone + 25} yd.` });
    if (bPct > cfg.tightenAbove && cfg.bCeil > cfg.bFloor) sugg.push({ stage: 'B', dir: 'tighten', change: { bCeil: cfg.bCeil - 1 }, text: `Stage B ticked on ${bPct.toFixed(0)}% of ${holes} holes. Tighten: B ceiling ${cfg.bCeil} → ${cfg.bCeil - 1}.` });
    else if (bPct < cfg.easeBelow && cfg.bCeil < 5) sugg.push({ stage: 'B', dir: 'ease', change: { bCeil: cfg.bCeil + 1 }, text: `Stage B ticked on only ${bPct.toFixed(0)}% of ${holes} holes. Ease: B ceiling ${cfg.bCeil} → ${cfg.bCeil + 1}.` });
    res.status = sugg.length ? 'suggest' : 'steady';
    res.suggestions = sugg;
    return res;
  }

  // Signature of the settings that change targets — tick % only compared within one signature.
  function cfgSig(cfg) {
    return [cfg.zone, cfg.k, cfg.par5Zone, cfg.basis, cfg.offset, cfg.bFloor, cfg.bCeil, cfg.reachAdj ? 1 : 0, cfg.par3Rule].join('|');
  }

  const DRILLS = {
    T: 'Fairway finder: 10 balls with your safest tee club at a 30 yd wide target; count balls in play.',
    AP: 'Long-approach ladder: alternate 150/170/190 yd targets, aim at the fat side of the green.',
    W: 'Wedge ladder: 50 / 75 / 100 yd, 5 balls each; score inside 10% of distance.',
    C: 'Up-and-down game: 9 chips/bunker shots from different lies, play each out; target 4+ in two.',
    P: 'Lag ladder (20/30/40 ft into a 3 ft circle) plus the 3 ft circle drill (12 in a row).',
    D: 'Pre-round plan: write tee club and miss side for every hole; review after the round.',
    M: 'Routine drill: same pre-shot routine on every range ball; finish each with a held finish.',
    A: 'Stage A plan: tee club that finds play + lay-up to your best wedge distance.',
    B: 'Stage B: wedge ladder + lag ladder, alternating sessions.',
  };

  const api = { BANDS, BAND_PRESETS, bandFor, defaultConfig, courseHandicap, playingHandicap, strokesOnHole, nineHoleSI, shotsNeeded, holeTargets, makeBaseline, holeResult, computeRound, summarise, closeBlockers, adaptiveSuggestion, cfgSig, effectiveCfg, roundHoles, DRILLS, whsRound };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TE = api;
})(typeof window !== 'undefined' ? window : globalThis);

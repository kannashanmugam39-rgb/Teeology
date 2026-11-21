/* Teeology app — UI and storage. Engine lives in engine.js (window.TE). */
(function () {
  'use strict';
  const TE = window.TE;
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => new Date().toISOString().slice(0, 10);
  const num = (x) => (x === '' || x === null || x === undefined || isNaN(+x) ? null : +x);
  const fmt = (x, d = 1) => (x === null || x === undefined || isNaN(x) ? '–' : (+x).toFixed(d));
  const sgn = (x, d = 1) => (x === null || x === undefined || isNaN(x) ? '–' : (x > 0 ? '+' : '') + (+x).toFixed(d));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const SKILLS = [
    ['drivDist', 'Driving distance'], ['drivAcc', 'Driving accuracy'], ['longApp', 'Long approach (150 yd+)'],
    ['wedges', 'Wedges (50–100 yd)'], ['short', 'Short game (inside 50 yd)'], ['bunker', 'Bunker play'],
    ['lag', 'Lag putting'], ['shortPutt', 'Short putts (inside 6 ft)'], ['mgmt', 'Course management'], ['mental', 'Mental / routine'],
  ];
  const FORMATS = [['individual', 'Individual'], ['scramble', 'Scramble'], ['foursomes', 'Foursomes'], ['fourball', 'Fourball'], ['practice', 'Practice']];

  // ================= STORAGE =================
  // Primary: artifact db, private per viewer (data/users/<id>/...). Mirror: localStorage (offline / fallback).
  const LS_KEY = 'teeology.v1';
  const S = {
    profile: null, courses: {}, rounds: {},
    mode: 'local', // 'cloud' when db is live
    db: null, userId: null,
    pending: {}, writing: {}, timers: {},
  };
  function defaultProfile() {
    const cfg = TE.defaultConfig();
    return {
      name: '', hi: 22, band: '21-28',
      cfg,
      bag: { T: 200, F: 160, par3Club: 160, clubs: ['Driver', '3 wood', '5 hybrid', '6 iron', '7 iron', '8 iron', '9 iron', 'PW', 'SW', 'Putter'] },
      skills: Object.fromEntries(SKILLS.map(s => [s[0], 3])),
      presets: {},
      changeLog: [],
      updatedAt: Date.now(),
    };
  }
  function lsLoad() {
    try { const raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function lsSave() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ profile: S.profile, courses: S.courses, rounds: S.rounds })); } catch (e) { /* storage unavailable */ }
  }
  function docKey(kind, id) { return kind === 'profile' ? 'profile' : (kind === 'course' ? 'c_' + id : 'r_' + id); }
  function save(kind, id) {
    const obj = kind === 'profile' ? S.profile : (kind === 'course' ? S.courses[id] : S.rounds[id]);
    if (obj) obj.updatedAt = Date.now();
    lsSave();
    if (!S.db || !S.userId) return;
    const key = docKey(kind, id);
    S.pending[key] = obj ? clone(obj) : { __deleted: true };
    clearTimeout(S.timers[key]);
    S.timers[key] = setTimeout(() => flush(key), 700);
  }
  async function flush(key) {
    if (S.writing[key]) return; // one write at a time per doc
    const body = S.pending[key];
    if (!body) return;
    delete S.pending[key];
    S.writing[key] = true;
    try {
      const ref = S.db.collection('data/users/' + S.userId).doc(key);
      if (body.__deleted) await ref.delete(); else await ref.set(body);
      setSync('cloud');
    } catch (e) {
      if (e && e.code === 'unavailable') { S.pending[key] = S.pending[key] || body; setTimeout(() => flush(key), 1500 + Math.random() * 1500); }
      else if (e && e.code === 'quota_exceeded') toast('Cloud storage is full — export a backup and delete old rounds.');
      else { setSync('local'); }
    } finally {
      S.writing[key] = false;
      if (S.pending[key]) flush(key);
    }
  }
  function setSync(m) { S.mode = m; const el = $('#sync'); if (el) el.textContent = m === 'cloud' ? '☁︎' : '📱'; }

  async function initCloud() {
    if (!window.claude || !window.claude.use) return;
    let db = null, user = null;
    try { [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]); } catch (e) { return; }
    if (!db || !user) return;
    let id = null;
    try { id = await user.id(); } catch (e) { id = null; }
    if (!id) return;
    S.db = db; S.userId = id;
    const timer = setTimeout(() => toast('Cloud backup not reachable yet — saving on this device.'), 10000);
    try {
      const snap = await db.collection('data/users/' + id).get();
      clearTimeout(timer);
      let changed = false;
      const local = { profile: S.profile, courses: S.courses, rounds: S.rounds };
      snap.docs.forEach(d => {
        const v = d.data(); if (!v) return;
        if (d.id === 'profile') { if (!S.profile || (v.updatedAt || 0) > (S.profile.updatedAt || 0)) { S.profile = migrateProfile(v); changed = true; } }
        else if (d.id.startsWith('c_')) { const k = d.id.slice(2); if (!S.courses[k] || (v.updatedAt || 0) > (S.courses[k].updatedAt || 0)) { S.courses[k] = v; changed = true; } }
        else if (d.id.startsWith('r_')) { const k = d.id.slice(2); if (!S.rounds[k] || (v.updatedAt || 0) > (S.rounds[k].updatedAt || 0)) { S.rounds[k] = v; changed = true; } }
      });
      // push anything that exists only locally (or is newer locally)
      const cloudIds = new Set(snap.docs.map(d => d.id));
      if (local.profile && !cloudIds.has('profile')) save('profile');
      Object.keys(S.courses).forEach(k => { if (!cloudIds.has('c_' + k)) save('course', k); });
      Object.keys(S.rounds).forEach(k => { if (!cloudIds.has('r_' + k)) save('round', k); });
      setSync('cloud');
      if (changed) { lsSave(); render(); }
    } catch (e) {
      clearTimeout(timer);
      setSync('local');
    }
  }
  function migrateProfile(p) {
    const d = defaultProfile();
    p.cfg = Object.assign(d.cfg, p.cfg || {});
    p.bag = Object.assign(d.bag, p.bag || {});
    p.skills = Object.assign(d.skills, p.skills || {});
    p.presets = p.presets || {}; p.changeLog = p.changeLog || [];
    return p;
  }

  // ================= VIEW STATE =================
  const V = { view: 'home', args: {}, tab: 'player' };
  function go(view, args) { V.view = view; V.args = args || {}; render(); window.scrollTo(0, 0); }
  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function confirmBox(msg, okText, fn) {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="sheet"><p>${esc(msg)}</p><div class="row"><button class="btn grow" data-x="no">Cancel</button><button class="btn pri grow" data-x="yes">${esc(okText)}</button></div></div>`;
    m.addEventListener('click', e => { const x = e.target.closest('[data-x]'); if (e.target === m || x) { m.remove(); if (x && x.dataset.x === 'yes') fn(); } });
    document.body.appendChild(m);
  }

  // ================= ROUND HELPERS =================
  function activeRound() { return Object.values(S.rounds).filter(r => r.status === 'open').sort((a, b) => b.createdAt - a.createdAt)[0]; }
  function closedRounds() { return Object.values(S.rounds).filter(r => r.status === 'closed').sort((a, b) => (a.date + a.createdAt).localeCompare(b.date + b.createdAt)); }
  function computed(r) { return TE.computeRound(r); }
  function statsRounds() {
    const minQ = S.profile.cfg.minQuality || 0;
    return closedRounds().filter(r => (r.format || 'individual') === 'individual' && (!minQ || (computed(r).summary.quality ?? 0) >= minQ));
  }

  // ================= RENDER =================
  function render() {
    const app = $('#app');
    const views = { home: vHome, settings: vSettings, courses: vCourses, course: vCourse, start: vStart, plan: vPlan, hole: vHole, summary: vSummary, history: vHistory, trends: vTrends, data: vData };
    const html = (views[V.view] || vHome)();
    app.innerHTML = html;
    afterRender();
  }
  function top(title, back) {
    return `<div class="top">${back ? `<button data-act="nav" data-v="${back}" aria-label="Back">‹</button>` : ''}<h1>${title}</h1><span id="sync" title="${S.mode === 'cloud' ? 'Backed up to your Claude account' : 'Saved on this device'}">${S.mode === 'cloud' ? '☁︎' : '📱'}</span></div>`;
  }
  function afterRender() {
    // live-bind inputs with data-bind
    document.querySelectorAll('[data-bind]').forEach(el => {
      el.addEventListener('change', onBind);
      if (el.tagName === 'INPUT' && (el.type === 'number' || el.type === 'text')) el.addEventListener('input', onBindInput);
    });
  }

  // ---------- HOME ----------
  function vHome() {
    const p = S.profile; const ar = activeRound(); const last = closedRounds().slice(-1)[0];
    const nCourses = Object.keys(S.courses).length;
    let lastHtml = '';
    if (last) {
      const c = computed(last); const s = c.summary;
      lastHtml = `<div class="card"><h2>Last round</h2><div class="mut">${esc(last.courseName)} · ${esc(last.date)}</div>
      <div class="stats" style="margin-top:10px">${stat(s.hasNR ? s.gross + '*' : s.gross, 'Gross')}${stat(s.stableford, 'Stableford')}${stat(sgn(s.vsNetPar, 0), 'vs net par')}${stat(s.aTicks + '/' + s.stagePlayed, 'A ✓')}${stat(s.bTicks + '/' + s.stagePlayed, 'B ✓')}${stat(s.netDoubles, 'Net doubles')}</div>
      <button class="btn block" style="margin-top:10px" data-act="nav" data-v="summary" data-id="${last.id}">Open summary</button></div>`;
    }
    const firstRun = !p.name && !nCourses && !Object.keys(S.rounds).length;
    return top('<span class="brand">TEEOLOGY</span>') + `<div class="wrap">
      ${S.mode !== 'cloud' ? `<div class="banner">Saving on this device. ${S.db || !window.claude ? '' : 'Sign in to claude.ai to back up rounds to your account. '}Export a backup from <b>Data</b> after each round.</div>` : ''}
      ${firstRun ? `<div class="card"><h2>Welcome</h2><p class="mut">Reach the zone, get down — targets set to your net par. Three quick steps:</p>
        <ol class="mut"><li>Set your handicap and distances</li><li>Add your course</li><li>Start a round</li></ol>
        <button class="btn pri block" data-act="nav" data-v="settings">1. Set up my profile</button></div>` : ''}
      ${ar ? `<div class="card"><h2>Round in progress</h2><div class="mut">${esc(ar.courseName)} · ${esc(ar.date)} · ${Object.keys(ar.entries || {}).length} holes entered</div>
        <button class="btn pri block" style="margin-top:10px" data-act="resume" data-id="${ar.id}">Continue round</button></div>`
        : `<button class="btn pri block" style="min-height:58px;font-size:18px;margin-bottom:12px" data-act="nav" data-v="${nCourses ? 'start' : 'course'}" ${nCourses ? '' : 'data-new="1"'}>${nCourses ? 'Start a round' : 'Add your first course'}</button>`}
      ${lastHtml}
      <div class="card list">
        <div class="it" data-act="nav" data-v="trends"><span class="grow"><b>Trends</b><div class="mut">Rolling stats, leaks, target suggestions</div></span>›</div>
        <div class="it" data-act="nav" data-v="history"><span class="grow"><b>Round history</b><div class="mut">${closedRounds().length} closed rounds</div></span>›</div>
        <div class="it" data-act="nav" data-v="courses"><span class="grow"><b>Courses</b><div class="mut">${nCourses} saved</div></span>›</div>
        <div class="it" data-act="nav" data-v="settings"><span class="grow"><b>Profile & settings</b><div class="mut">HI ${fmt(p.hi)} · band ${esc(bandName(p.band))} · zone ${p.cfg.zone} yd</div></span>›</div>
        <div class="it" data-act="nav" data-v="data"><span class="grow"><b>Data</b><div class="mut">Export CSV / JSON, backup, restore</div></span>›</div>
      </div>
      <p class="mut small" style="text-align:center">Strokes-gained uses an <b>estimated</b> baseline until you have 20+ rounds.</p>
    </div>`;
  }
  const stat = (v, k) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`;
  const bandName = (id) => (TE.BANDS.find(b => b.id === id) || {}).name || id;

  // ---------- SETTINGS ----------
  function vSettings() {
    const p = S.profile, c = p.cfg;
    const tabs = [['player', 'Player'], ['bag', 'Bag'], ['targets', 'Targets'], ['par3', 'Par 3 / 5'], ['codes', 'Codes'], ['fields', 'Fields & cues'], ['analysis', 'Analysis'], ['presets', 'Presets']];
    const t = V.tab;
    let body = '';
    if (t === 'player') {
      const bp = TE.BAND_PRESETS[p.band];
      body = `<div class="card stack">
        <div><label class="f">Name</label><input type="text" data-bind="profile.name" value="${esc(p.name)}" placeholder="Your name"></div>
        <div class="grid2"><div><label class="f">Handicap index (plus = negative, e.g. -2.0)</label><input type="number" step="0.1" min="-8" max="54" data-bind="profile.hi" value="${p.hi}"></div>
        <div><label class="f">Band</label><select data-bind="profile.band">${TE.BANDS.map(b => `<option value="${b.id}" ${b.id === p.band ? 'selected' : ''}>${b.name}</option>`).join('')}</select></div></div>
        ${TE.bandFor(+p.hi) !== p.band ? `<div class="banner">Your index puts you in the ${bandName(TE.bandFor(+p.hi))} band. <button class="btn" data-act="setband" data-b="${TE.bandFor(+p.hi)}">Switch band</button></div>` : ''}
        <div class="hdr"><b>${bandName(p.band)} starting preset</b><div class="mut small">Zone ${bp.zone} yd · ${bp.basis === 'gross' ? 'gross par' : 'net par'} targets · B ceiling ${bp.bCeil} · par-3 rule: ${par3Name(bp.par3Rule)}<br>Focus: ${esc(bp.focus)}<br>First recommendation: ${esc(bp.rec)}</div>
        <button class="btn" style="margin-top:8px" data-act="applyband">Apply this preset to my targets</button></div>
      </div>
      <div class="card"><h2>Strengths & weaknesses</h2><p class="mut small">1 = weak, 5 = strong. Ratings shape advice only — they never change your targets.</p>
        ${SKILLS.map(([k, n]) => `<div class="fld"><div class="lab">${n}</div><div class="chips">${[1, 2, 3, 4, 5].map(v => `<button class="chip sm ${p.skills[k] === v ? 'on' : ''}" data-act="skill" data-k="${k}" data-v="${v}">${v}</button>`).join('')}</div></div>`).join('')}
      </div>`;
    } else if (t === 'bag') {
      body = `<div class="card stack"><p class="mut small">These distances drive the reach adjustment (how many shots you need to reach the zone on long holes). Use real carry numbers.</p>
        <div class="grid3"><div><label class="f">Tee shot T (yd)</label><input type="number" data-bind="bag.T" value="${p.bag.T}"></div>
        <div><label class="f">Reliable fairway shot F (yd)</label><input type="number" data-bind="bag.F" value="${p.bag.F}"></div>
        <div><label class="f">Longest reliable par-3 club (yd)</label><input type="number" data-bind="bag.par3Club" value="${p.bag.par3Club}"></div></div>
        <div><label class="f">Clubs (one per line, for tee-club picks)</label><textarea data-bind="bag.clubs" rows="8">${esc(p.bag.clubs.join('\n'))}</textarea></div></div>`;
    } else if (t === 'targets') {
      body = `<div class="card stack">
        ${numF('Zone distance (yd)', 'cfg.zone', c.zone, 20, 250)}
        ${selF('Target basis', 'cfg.basis', c.basis, [['net', 'Net par (par + strokes)'], ['gross', 'Gross par']])}
        ${numF('Target offset (+/− shots per hole)', 'cfg.offset', c.offset, -2, 3)}
        ${selF('Regulation shots to zone (k)', 'cfg.k', c.k, [[1, 'Par − 1'], [2, 'Par − 2'], [3, 'Par − 3']])}
        <div class="grid2">${numF('Stage B floor', 'cfg.bFloor', c.bFloor, 1, 3)}${numF('Stage B ceiling', 'cfg.bCeil', c.bCeil, 1, 5)}</div>
        ${selF('Reach adjustment (uses your distances)', 'cfg.reachAdj', c.reachAdj ? '1' : '0', [['1', 'On'], ['0', 'Off (paper card)']])}
        ${selF('Stretch holes (ticks add up to more than target)', 'cfg.stretchPolicy', c.stretchPolicy, [['keep', 'Keep target, flag hole'], ['raise', 'Raise that hole’s target']])}
        ${selF('Leak prompt', 'cfg.leakThreshold', c.leakThreshold, [[0, 'When over target'], [1, 'Over target by 2+'], [2, 'Over target by 3+'], [-1, 'Off']])}
        ${selF('Entry mode', 'cfg.entryMode', c.entryMode, [['quick', 'Quick (4 inputs)'], ['full', 'Full']])}
        <div class="mut small">With the defaults and reach off this reproduces the paper card: 0 strokes → zone par−2, B 2; 1 stroke → par−2 / 3; 2 strokes → par−1 / 3.</div></div>`;
    } else if (t === 'par3') {
      body = `<div class="card stack">
        ${selF('Par-3 success rule', 'cfg.par3Rule', c.par3Rule, [['greenOrNear', 'Green or near'], ['green', 'Green only'], ['reach', 'Reach zone (paper original)']])}
        ${numF('Par-3 reach margin (yd added to your par-3 club)', 'cfg.par3Margin', c.par3Margin, 0, 30)}
        ${numF('"Near" = within N yd of green edge', 'cfg.nearYd', c.nearYd, 0, 25)}
        ${selF('Par-5 zone target', 'cfg.par5Zone', c.par5Zone, [[3, '3 shots'], [2, '2 shots']])}
        <div class="mut small">Par-3 rule applies only when the hole is within reach: yardage ≤ ${p.bag.par3Club} + ${c.par3Margin} = ${(+p.bag.par3Club) + (+c.par3Margin)} yd.</div></div>`;
    } else if (t === 'codes') {
      body = `<div class="card stack"><p class="mut small">One per line: <code>CODE = Name</code> (penalties: <code>CODE = Name = strokes</code>).</p>
        <div><label class="f">Tee result codes</label><textarea rows="8" data-bind="codes.teeCodes">${esc(c.teeCodes.map(x => x.code + ' = ' + x.name).join('\n'))}</textarea></div>
        <div><label class="f">Penalty codes</label><textarea rows="5" data-bind="codes.penaltyCodes">${esc(c.penaltyCodes.map(x => x.code + ' = ' + x.name + ' = ' + x.strokes).join('\n'))}</textarea></div>
        <div><label class="f">Leak codes</label><textarea rows="7" data-bind="codes.leakCodes">${esc(c.leakCodes.map(x => x.code + ' = ' + x.name).join('\n'))}</textarea></div>
        <div><label class="f">Lies (add * after the name if it does NOT count as in-zone)</label><textarea rows="6" data-bind="codes.lies">${esc(c.lies.map(x => x.code + ' = ' + x.name + (x.inZone ? '' : ' *')).join('\n'))}</textarea></div></div>`;
    } else if (t === 'fields') {
      body = `<div class="card stack">
        <div><label class="f">Swing cues (one per line; optionally "7,12: cue" to show on holes 7 and 12; others show after a bad hole)</label><textarea rows="5" data-bind="cfg.cues">${esc((c.cues || []).join('\n'))}</textarea></div>
        <div><label class="f">Custom per-hole fields (one per line: <code>Name : number|yesno|text</code>)</label><textarea rows="4" data-bind="cfg.customFields">${esc((c.customFields || []).map(f => f.name + ' : ' + f.type).join('\n'))}</textarea></div></div>`;
    } else if (t === 'analysis') {
      body = `<div class="card stack">
        ${selF('Rolling window', 'cfg.rollingWindow', c.rollingWindow, [[5, '5 rounds'], [10, '10 rounds'], [20, '20 rounds'], [999, 'All']])}
        ${numF('Minimum sample to show a stat', 'cfg.minSample', c.minSample, 5, 50)}
        ${numF('Leave rounds out of trends below this data quality (%)', 'cfg.minQuality', c.minQuality || 0, 0, 100)}
        ${selF('Strokes-gained baseline', 'cfg.baselineBand', c.baselineBand || '', [['', 'My handicap band']].concat(TE.BANDS.map(b => [b.id, b.name + ' band'])))}
        <div class="grid2">${numF('Tighten when ticks above %', 'cfg.tightenAbove', c.tightenAbove, 50, 95)}${numF('Ease when ticks below %', 'cfg.easeBelow', c.easeBelow, 10, 60)}</div>
        <div class="grid3">${numF('Evidence rounds', 'cfg.evidenceRounds', c.evidenceRounds, 5, 30)}${numF('Evidence holes', 'cfg.evidenceHoles', c.evidenceHoles, 50, 400)}${numF('Cooldown rounds', 'cfg.cooldownRounds', c.cooldownRounds, 5, 30)}</div>
        <div class="mut small">The baseline tables are <b>estimates</b> for testing until a licensed amateur dataset or your own 20+ rounds are available.</div></div>`;
    } else if (t === 'presets') {
      const names = Object.keys(p.presets);
      body = `<div class="card stack"><p class="mut small">Save your current settings under a name (e.g. "Winter 100 yd", "Comp day"). A round copies its preset when it starts, so later edits never change past rounds.</p>
        <div class="row"><input type="text" id="presetName" placeholder="Preset name" class="grow"><button class="btn pri" data-act="savepreset">Save</button></div>
        <div class="list">${names.length ? names.map(n => `<div class="it"><span class="grow"><b>${esc(n)}</b><div class="mut small">zone ${p.presets[n].zone} yd · B ${p.presets[n].bFloor}–${p.presets[n].bCeil} · ${p.presets[n].basis}</div></span><button class="btn" data-act="loadpreset" data-n="${esc(n)}">Use</button><button class="btn danger" data-act="delpreset" data-n="${esc(n)}">✕</button></div>`).join('') : '<p class="mut">No presets saved yet.</p>'}</div></div>
        <div class="card"><h2>Target change log</h2>${p.changeLog.length ? p.changeLog.map(l => `<div class="mut small">${esc(l.date)} — ${esc(l.text)}</div>`).join('') : '<p class="mut small">No changes yet.</p>'}</div>`;
    }
    return top('Profile & settings', 'home') + `<div class="wrap"><div class="tabs">${tabs.map(([k, n]) => `<button class="chip sm ${t === k ? 'on' : ''}" data-act="tab" data-t="${k}">${n}</button>`).join('')}</div>${body}
      <button class="btn pri block" data-act="nav" data-v="home">Done</button></div>`;
  }
  const par3Name = (r) => ({ green: 'green only', greenOrNear: 'green or near', reach: 'reach zone' }[r] || r);
  function numF(lab, bind, v, min, max) { return `<div><label class="f">${lab}</label><input type="number" data-bind="${bind}" value="${v}" ${min !== undefined ? `min="${min}"` : ''} ${max !== undefined ? `max="${max}"` : ''}></div>`; }
  function selF(lab, bind, v, opts) { return `<div><label class="f">${lab}</label><select data-bind="${bind}">${opts.map(([k, n]) => `<option value="${k}" ${String(k) === String(v) ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`; }

  function parseCodes(text, kind) {
    return text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const parts = l.split('=').map(s => s.trim());
      if (kind === 'penaltyCodes') return { code: parts[0], name: parts[1] || parts[0], strokes: num(parts[2]) ?? 1 };
      if (kind === 'lies') { const nm = parts[1] || parts[0]; return { code: parts[0], name: nm.replace(/\*$/, '').trim(), inZone: !/\*$/.test(nm) }; }
      return { code: parts[0], name: parts[1] || parts[0] };
    });
  }

  function onBindInput(e) { if (e.target.dataset.bind.startsWith('h.') || e.target.dataset.bind.startsWith('in.')) onBind(e, true); }
  function onBind(e, live) {
    const el = e.target; const b = el.dataset.bind; const v = el.type === 'checkbox' ? el.checked : el.value;
    const p = S.profile;
    const [scope, key] = [b.slice(0, b.indexOf('.')), b.slice(b.indexOf('.') + 1)];
    const intKeys = ['zone', 'offset', 'k', 'bFloor', 'bCeil', 'par3Margin', 'nearYd', 'par5Zone', 'leakThreshold', 'rollingWindow', 'minSample', 'tightenAbove', 'easeBelow', 'evidenceRounds', 'evidenceHoles', 'cooldownRounds', 'minQuality'];
    if (scope === 'profile') { p[key] = key === 'hi' ? (num(v) ?? p.hi) : v; save('profile'); if (key === 'band') render(); return; }
    if (scope === 'bag') {
      if (key === 'clubs') p.bag.clubs = v.split('\n').map(s => s.trim()).filter(Boolean);
      else p.bag[key] = num(v) ?? p.bag[key];
      save('profile'); return;
    }
    if (scope === 'cfg') {
      if (key === 'cues') p.cfg.cues = v.split('\n').map(s => s.trim()).filter(Boolean);
      else if (key === 'customFields') p.cfg.customFields = v.split('\n').map(s => s.trim()).filter(Boolean).map((l, i) => { const [n, t] = l.split(':').map(x => x.trim()); return { id: 'cf' + i + '_' + n.replace(/\W+/g, ''), name: n, type: ['number', 'yesno', 'text'].includes(t) ? t : 'text' }; });
      else if (key === 'reachAdj') p.cfg.reachAdj = v === '1';
      else if (key === 'baselineBand') p.cfg.baselineBand = v || null;
      else if (intKeys.includes(key)) p.cfg[key] = num(v) ?? p.cfg[key];
      else p.cfg[key] = v;
      if (p.cfg.bCeil < p.cfg.bFloor) p.cfg.bCeil = p.cfg.bFloor;
      save('profile'); return;
    }
    if (scope === 'codes') { const parsed = parseCodes(v, key); if (parsed.length) { p.cfg[key] = parsed; save('profile'); } return; }
    if (scope === 'course') return courseBind(key, v);
    if (scope === 'start') { V.args[key] = v; render(); return; }
    if (scope === 'h' || scope === 'in') return holeBind(key, v, live);
    if (scope === 'rnd') { const r = S.rounds[V.args.id]; r[key] = v; save('round', r.id); return; }
    if (scope === 'ov') { const r = S.rounds[V.args.id]; const [n, k] = key.split('.'); r.overrides = r.overrides || {}; r.overrides[n] = r.overrides[n] || {}; r.overrides[n][k] = k === 'teeClub' ? v : num(v); save('round', r.id); render(); return; }
  }

  // ---------- COURSES ----------
  function vCourses() {
    const cs = Object.values(S.courses).sort((a, b) => a.name.localeCompare(b.name));
    return top('Courses', 'home') + `<div class="wrap"><button class="btn pri block" data-act="nav" data-v="course" data-new="1">+ Add course / tee</button>
      <div class="card list" style="margin-top:12px">${cs.length ? cs.map(c => `<div class="it" data-act="nav" data-v="course" data-id="${c.id}"><span class="grow"><b>${esc(c.name)}</b><div class="mut small">${esc(c.tee)} tees · par ${parTotal(c)} · CR ${c.cr} / slope ${c.slope} · ${c.holes.reduce((t, h) => t + (+h.yards || 0), 0)} yd</div></span>›</div>`).join('') : '<p class="mut">No courses yet.</p>'}</div></div>`;
  }
  const parTotal = (c) => c.holes.reduce((t, h) => t + (+h.par || 0), 0);
  function newCourse() {
    return { id: uid(), name: '', tee: 'Yellow', cr: 70.0, slope: 125, cr9f: '', slope9f: '', cr9b: '', slope9b: '', holes: Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1, yards: 380 })), createdAt: Date.now() };
  }
  function vCourse() {
    if (!V.args.draft) V.args.draft = V.args.id && S.courses[V.args.id] ? clone(S.courses[V.args.id]) : newCourse();
    const c = V.args.draft;
    const sis = c.holes.map(h => +h.si); const dup = sis.length !== new Set(sis).size || sis.some(s => s < 1 || s > 18);
    return top(c.name ? esc(c.name) : 'New course', 'courses') + `<div class="wrap">
      <div class="card stack"><div class="grid2"><div><label class="f">Course name</label><input type="text" data-bind="course.name" value="${esc(c.name)}"></div>
      <div><label class="f">Tees</label><input type="text" data-bind="course.tee" value="${esc(c.tee)}"></div></div>
      <div class="grid2"><div><label class="f">Course rating (18)</label><input type="number" step="0.1" data-bind="course.cr" value="${c.cr}"></div><div><label class="f">Slope (18)</label><input type="number" data-bind="course.slope" value="${c.slope}"></div></div>
      <details><summary class="mut">9-hole ratings (optional)</summary><div class="grid2" style="margin-top:8px">
        <div><label class="f">Front 9 CR</label><input type="number" step="0.1" data-bind="course.cr9f" value="${c.cr9f}" placeholder="${fmt(c.cr / 2)}"></div><div><label class="f">Front 9 slope</label><input type="number" data-bind="course.slope9f" value="${c.slope9f}" placeholder="${c.slope}"></div>
        <div><label class="f">Back 9 CR</label><input type="number" step="0.1" data-bind="course.cr9b" value="${c.cr9b}" placeholder="${fmt(c.cr / 2)}"></div><div><label class="f">Back 9 slope</label><input type="number" data-bind="course.slope9b" value="${c.slope9b}" placeholder="${c.slope}"></div></div></details>
      </div>
      <div class="card"><h2>Holes <span class="mut small">par ${parTotal(c)} · ${c.holes.reduce((t, h) => t + (+h.yards || 0), 0)} yd</span></h2>
      <div class="mut small" style="margin-bottom:6px">⛳ ${c.holes.filter(h => h.green).length} of ${c.holes.length} greens marked by GPS (mark them from the hole screen while you play).</div>
      ${dup ? '<div class="flag bad">Stroke indexes must be 1–18 with no repeats</div>' : ''}
      <table class="hgrid"><tr><th>Hole</th><th>Par</th><th>SI</th><th>Yards</th></tr>
      ${c.holes.map((h, i) => `<tr><td><b>${h.n}</b></td><td><input type="number" min="3" max="6" data-bind="course.h.${i}.par" value="${h.par}"></td><td><input type="number" min="1" max="18" data-bind="course.h.${i}.si" value="${h.si}"></td><td><input type="number" data-bind="course.h.${i}.yards" value="${h.yards}"></td></tr>`).join('')}</table></div>
      <button class="btn pri block" data-act="savecourse" ${dup || !c.name ? 'disabled' : ''}>Save course</button>
      ${S.courses[c.id] ? `<button class="btn danger block" style="margin-top:10px" data-act="delcourse" data-id="${c.id}">Delete course</button>` : ''}
    </div>`;
  }
  function courseBind(key, v) {
    const c = V.args.draft;
    if (key.startsWith('h.')) { const [, i, f] = key.split('.'); c.holes[+i][f] = num(v) ?? ''; }
    else if (['cr', 'slope', 'cr9f', 'slope9f', 'cr9b', 'slope9b'].includes(key)) c[key] = num(v) ?? '';
    else c[key] = v;
    const keepY = window.scrollY; render(); window.scrollTo(0, keepY);
  }

  // ---------- START ROUND ----------
  function vStart() {
    const p = S.profile; const a = V.args;
    const cs = Object.values(S.courses);
    if (!a.courseId && cs.length) a.courseId = cs[0].id;
    a.date = a.date || today(); a.holesPlayed = a.holesPlayed || '18'; a.format = a.format || 'individual';
    a.allowance = a.allowance ?? p.cfg.allowance; a.preset = a.preset ?? ''; a.entryMode = a.entryMode || p.cfg.entryMode;
    const c = S.courses[a.courseId];
    const ph = c ? calcPH(c, a) : null;
    return top('Start round', 'home') + `<div class="wrap"><div class="card stack">
      ${selF('Course / tees', 'start.courseId', a.courseId, cs.map(x => [x.id, x.name + ' — ' + x.tee]))}
      <div class="grid2"><div><label class="f">Date</label><input type="date" data-bind="start.date" value="${a.date}"></div>
      ${selF('Holes', 'start.holesPlayed', a.holesPlayed, [['18', '18 holes'], ['F9', 'Front 9'], ['B9', 'Back 9']])}</div>
      <div class="grid2">${selF('Format', 'start.format', a.format, FORMATS)}${selF('Allowance', 'start.allowance', a.allowance, [[100, '100%'], [95, '95% (individual stroke play)'], [90, '90%'], [85, '85%'], [75, '75%']])}</div>
      <div class="grid2"><div><label class="f">Handicap index</label><input type="number" step="0.1" data-bind="start.hi" value="${a.hi ?? p.hi}"></div>
      <div><label class="f">Playing handicap override</label><input type="number" data-bind="start.phOverride" value="${a.phOverride ?? ''}" placeholder="auto"></div></div>
      ${selF('Settings preset', 'start.preset', a.preset, [['', 'My current settings']].concat(Object.keys(p.presets).map(n => [n, n])))}
      ${selF('Entry mode', 'start.entryMode', a.entryMode, [['quick', 'Quick (4 inputs per hole)'], ['full', 'Full']])}
      <details><summary class="mut">Conditions (optional)</summary><div class="grid2" style="margin-top:8px">
        ${selF('Wind', 'start.wind', a.wind || '', [['', '–'], ['calm', 'Calm'], ['breezy', 'Breezy'], ['windy', 'Windy'], ['gale', 'Very windy']])}
        ${selF('Ground', 'start.ground', a.ground || '', [['', '–'], ['firm', 'Firm'], ['normal', 'Normal'], ['soft', 'Soft'], ['wet', 'Wet / winter']])}
        <div><label class="f">Temperature (°C)</label><input type="number" data-bind="start.temp" value="${a.temp ?? ''}"></div>
        ${selF('Green speed', 'start.greens', a.greens || '', [['', '–'], ['slow', 'Slow'], ['medium', 'Medium'], ['fast', 'Fast']])}</div></details>
      </div>
      ${c ? `<div class="hdr"><div class="row"><div class="grow"><div class="mut small">Playing handicap</div><div class="big">${ph.ph}</div></div><div class="mut small" style="text-align:right">Course HC ${fmt(ph.ch)}<br>CR ${ph.cr} · slope ${ph.slope} · par ${ph.par}</div></div></div>` : ''}
      ${a.format !== 'individual' ? '<div class="banner">Team and practice rounds are saved but do not feed your personal stats.</div>' : ''}
      <button class="btn pri block" data-act="createround" ${c ? '' : 'disabled'}>Calculate targets & plan</button></div>`;
  }
  function calcPH(c, a) {
    const hi = num(a.hi) ?? S.profile.hi;
    const hp = a.holesPlayed || '18';
    let par, cr, slope, nine = false;
    if (hp === '18') { par = parTotal(c); cr = c.cr; slope = c.slope; }
    else {
      nine = true; const hs = hp === 'F9' ? c.holes.slice(0, 9) : c.holes.slice(9);
      par = hs.reduce((t, h) => t + +h.par, 0);
      cr = num(hp === 'F9' ? c.cr9f : c.cr9b) ?? +(c.cr / 2).toFixed(1);
      slope = num(hp === 'F9' ? c.slope9f : c.slope9b) ?? c.slope;
    }
    const ch = TE.courseHandicap(hi, slope, cr, par, nine);
    const ph = num(a.phOverride) ?? TE.playingHandicap(ch, +a.allowance);
    return { ch, ph, cr, slope, par, hi };
  }
  function createRound() {
    const p = S.profile; const a = V.args; const c = S.courses[a.courseId];
    const ph = calcPH(c, a);
    const cfg = clone(a.preset && p.presets[a.preset] ? Object.assign(TE.defaultConfig(), p.presets[a.preset]) : p.cfg);
    cfg.allowance = +a.allowance; cfg.entryMode = a.entryMode;
    const r = {
      id: uid(), createdAt: Date.now(), status: 'open', date: a.date,
      courseId: c.id, courseName: c.name + ' (' + c.tee + ')', holes: clone(c.holes), cr: ph.cr, slope: ph.slope,
      holesPlayed: a.holesPlayed, format: a.format, hi: ph.hi, ch: ph.ch, ph: ph.ph, phOverride: num(a.phOverride),
      cfg, presetName: a.preset || 'Current settings', cfgSig: TE.cfgSig(cfg),
      bag: { T: p.bag.T, F: p.bag.F, par3Club: p.bag.par3Club }, band: p.band, baselineBand: cfg.baselineBand || p.band,
      conditions: { wind: a.wind || '', ground: a.ground || '', temp: a.temp ?? '', greens: a.greens || '' },
      entries: {}, overrides: {}, plan: {}, notes: { best: '', fix: '' },
    };
    S.rounds[r.id] = r; save('round', r.id);
    go('plan', { id: r.id });
  }

  // ---------- PLAN ----------
  function vPlan() {
    const r = S.rounds[V.args.id]; if (!r) return vHome();
    const comp = computed(r); const p = S.profile;
    const openN = V.args.edit;
    return top('Pre-round plan', 'home') + `<div class="wrap">
      <div class="hdr"><b>${esc(r.courseName)}</b><div class="mut small">${esc(r.date)} · PH ${r.ph} · ${esc(r.presetName)} · zone ${r.cfg.zone} yd${r.cfg.reachAdj ? ' · reach-adjusted (T ' + r.bag.T + ', F ' + r.bag.F + ')' : ''}</div>
        <div class="mut small">Target = net par${r.cfg.offset ? (r.cfg.offset > 0 ? ' +' : ' ') + r.cfg.offset : ''}. Tick A by reaching the zone in the zone target; tick B by holing out in the B target.${comp.summary.stretch ? ` <span class="flag">${comp.summary.stretch} stretch hole${comp.summary.stretch > 1 ? 's' : ''}</span>` : ''}</div></div>
      <div class="card" style="padding:8px"><table class="t"><tr><th>H</th><th>Par</th><th>SI</th><th>Yd</th><th>Str</th><th>Tgt</th><th>Zone</th><th>B</th><th class="l">Tee club</th></tr>
      ${comp.holes.map(x => `<tr data-act="planedit" data-n="${x.hole.n}" style="cursor:pointer"><td><b>${x.hole.n}</b></td><td>${x.t.par}</td><td>${x.hole.si}</td><td>${x.hole.yards}</td><td>${x.t.strokes > 0 ? '•'.repeat(x.t.strokes) : (x.t.strokes < 0 ? '+' + (-x.t.strokes) : '')}</td><td><b>${x.t.target}</b></td><td>${x.t.zoneT}${x.t.stretch ? '<span class="flag" title="stretch hole">S</span>' : ''}${x.t.par3Applies ? '<sup>p3</sup>' : ''}</td><td>${x.t.bT}</td><td class="l small">${esc((r.overrides[x.hole.n] || {}).teeClub || '')}</td></tr>
        ${openN == x.hole.n ? `<tr><td colspan="9" style="text-align:left;background:var(--tint)"><div class="grid2" style="padding:6px">
          ${selF('Tee club', 'ov.' + x.hole.n + '.teeClub', (r.overrides[x.hole.n] || {}).teeClub || '', [['', '–']].concat(p.bag.clubs.map(c => [c, c])))}
          ${numF('Zone (yd) for this hole', 'ov.' + x.hole.n + '.zone', (r.overrides[x.hole.n] || {}).zone ?? '', 20, 250)}
          ${numF('Lay-up point (yd from hole)', 'ov.' + x.hole.n + '.layup', (r.overrides[x.hole.n] || {}).layup ?? '', 0, 300)}
          ${numF('Target offset', 'ov.' + x.hole.n + '.offset', (r.overrides[x.hole.n] || {}).offset ?? '', -2, 3)}</div>
          <div class="mut small" style="padding:0 6px 6px">Reach: ${x.t.n || '–'} shots needed · A min ${x.t.aMin}${x.t.par3Applies ? ' · par-3 rule applies (tee shot must finish ' + par3Name(r.cfg.par3Rule) + ')' : ''}</div></td></tr>` : ''}`).join('')}
      <tr><td></td><td><b>${comp.holes.reduce((t, x) => t + x.t.par, 0)}</b></td><td></td><td></td><td></td><td><b>${comp.holes.reduce((t, x) => t + x.t.target, 0)}</b></td><td></td><td></td><td></td></tr></table>
      <p class="mut small">Tap a hole to set a tee club, lay-up or override for that hole.</p></div>
      <button class="btn pri block" data-act="nav" data-v="hole" data-id="${r.id}" data-n="${firstUnplayed(r, comp)}">Go to the 1st tee</button>
      <button class="btn danger block" style="margin-top:10px" data-act="delround" data-id="${r.id}">Cancel this round</button></div>`;
  }
  function firstUnplayed(r, comp) { const x = comp.holes.find(h => !h.r.complete); return x ? x.hole.n : comp.holes[0].hole.n; }

  // ---------- HOLE ENTRY ----------
  function vHole() {
    const r = S.rounds[V.args.id]; if (!r) return vHome();
    const comp = computed(r);
    const idx = Math.max(0, comp.holes.findIndex(x => x.hole.n == V.args.n));
    const x = comp.holes[idx]; const n = x.hole.n; const t = x.t; const res = x.r; const c = r.cfg;
    const inp = r.entries[n] || {};
    const quick = (V.args.mode || r.cfg.entryMode) === 'quick';
    const plan = r.overrides[n] || {};
    const cues = cuesFor(r, n, comp, idx);
    const zoneLies = c.lies.filter(l => l.inZone);
    const isP3 = t.par3Applies;
    const teeCodes = c.teeCodes.filter(tc => t.par === 3 ? true : !['G', 'N', 'M'].includes(tc.code));
    const leakChips = (field, sel) => `<div class="chips">${c.leakCodes.map(l => `<button class="chip sm ${sel === l.code ? 'on' : ''}" data-act="set" data-f="${field}" data-v="${esc(l.code)}" title="${esc(l.name)}">${esc(l.code)}</button>`).join('')}${field === 'leak2' ? `<button class="chip sm ${!sel ? 'on' : ''}" data-act="set" data-f="leak2" data-v="">none</button>` : ''}</div>`;
    const stepper = (field, val, hint) => `<div class="step"><button data-act="dec" data-f="${field}" aria-label="minus">−</button><div class="v ${val === undefined || val === '' || val === null ? 'empty' : ''}">${val === undefined || val === '' || val === null ? (hint ?? '–') : val}</div><button data-act="inc" data-f="${field}" aria-label="plus">+</button></div>`;
    const tick = (v) => v === true ? '<span class="tick y">✓</span>' : v === false ? '<span class="tick n">✗</span>' : '–';
    const leakInfo = res.leakNeeded ? (res.sgA !== undefined ? `Most lost in stage ${res.worstStage} (${res.worstStage === 'A' ? 'getting to the zone' : 'zone to hole'})` : `Over target — stage ${res.worstStage} looks like the leak`) : '';
    return top(`Hole ${n} <span class="mut" style="color:#cfe">${idx + 1}/${comp.holes.length}</span>`, 'home') + `<div class="wrap">
      <div class="hdr"><div class="row"><div class="big grow">Par ${t.par}</div><div class="mut small" style="text-align:right">SI ${x.hole.si} · ${x.hole.yards} yd<br>${t.strokes ? (t.strokes > 0 ? t.strokes + ' stroke' + (t.strokes > 1 ? 's' : '') : 'gives ' + (-t.strokes)) : 'no strokes'}</div></div>
        <div class="tgts"><span class="tg">Target <b>${t.target}</b></span><span class="tg">Zone in <b>${t.zoneT}</b></span><span class="tg">Then <b>${t.bT}</b></span><span class="tg">Zone <b>${t.zone}</b> yd</span></div>
        <div style="margin-top:6px">${t.stretch ? '<span class="flag">Stretch hole: ticks add up to ' + (t.zoneT + t.bT) + '</span> ' : ''}${isP3 ? `<span class="flag">Par-3 rule: tee shot ${par3Name(c.par3Rule)}</span> ` : ''}${plan.teeClub ? `<span class="tg small">Plan: ${esc(plan.teeClub)}</span> ` : ''}${plan.layup ? `<span class="tg small">Lay up to ${plan.layup} yd</span>` : ''}</div>
        ${cues ? `<div class="banner" style="margin:8px 0 0">Cue: ${esc(cues)}</div>` : ''}</div>

      <div class="row" style="justify-content:flex-end;margin-bottom:8px"><button class="chip sm ${quick ? 'on' : ''}" data-act="mode" data-m="${quick ? 'full' : 'quick'}">${quick ? 'Quick mode ✓' : 'Quick mode'}</button></div>

      ${inp.pickup ? `<div class="banner">Picked up (NR) in stage ${inp.pickupStage || 'A'} — scores net double bogey, 0 pts. <button class="btn" data-act="set" data-f="pickup" data-v="">Undo</button></div>` : ''}

      ${!quick ? `<div class="fld"><div class="lab">Tee club</div><select data-bind="in.teeClub"><option value="">–</option>${S.profile.bag.clubs.map(cl => `<option ${((inp.teeClub ?? plan.teeClub) === cl) ? 'selected' : ''}>${esc(cl)}</option>`).join('')}</select></div>` : ''}
      ${!quick || isP3 ? `<div class="fld"><div class="lab">Tee result</div><div class="chips">${teeCodes.map(tc => `<button class="chip ${inp.tee === tc.code ? 'on' : ''}" data-act="set" data-f="tee" data-v="${esc(tc.code)}" title="${esc(tc.name)}">${esc(tc.code)}</button>`).join('')}</div><div class="mut small" style="margin-top:4px">${teeCodes.map(tc => tc.code + ' ' + tc.name).join(' · ')}</div></div>` : ''}

      <div class="fld"><div class="lab">Shots to zone <span class="mut">incl. penalties · target ${t.zoneT}</span></div>${stepper('toZone', inp.toZone, t.zoneT)}</div>

      ${!quick ? `<div class="fld"><div class="lab">Entered the zone from <span class="mut">${inp.entryLie === 'G' ? 'first putt in ft' : 'yards to hole'}</span></div>
        <div class="chips" style="margin-bottom:8px">${zoneLies.map(l => `<button class="chip sm ${(inp.entryLie || '') === l.code ? 'on' : ''}" data-act="set" data-f="entryLie" data-v="${esc(l.code)}">${esc(l.name)}</button>`).join('')}</div>
        ${inp.entryLie === 'G' ? `<input type="number" inputmode="numeric" data-bind="in.firstPuttFt" value="${inp.firstPuttFt ?? ''}" placeholder="first putt (ft)">` : `<input type="number" inputmode="numeric" data-bind="in.entryYd" value="${inp.entryYd ?? ''}" placeholder="e.g. 85">`}
        ${gpsRow(r, n, inp)}</div>` : ''}

      <div class="fld"><div class="lab">Zone shots <span class="mut">to hole out · target ${t.bT}</span></div>${stepper('zoneShots', inp.zoneShots, t.bT)}</div>
      <div class="fld"><div class="lab">Putts</div>${stepper('putts', inp.putts, 2)}</div>

      ${!quick ? `<div class="grid2 fld"><div><label class="f">Prox after 1st zone shot (ft)</label><input type="number" inputmode="numeric" data-bind="in.prox" value="${inp.prox ?? ''}"></div>
        ${inp.entryLie === 'G' ? '' : `<div><label class="f">First putt (ft)</label><input type="number" inputmode="numeric" data-bind="in.firstPuttFt" value="${inp.firstPuttFt ?? ''}"></div>`}</div>` : ''}

      <div class="fld"><div class="lab">Penalties <span class="mut">already counted in your shots</span></div>
        ${(inp.penalties || []).map((pn, i) => `<div class="pen"><span class="flag bad">${esc(pn.code)} +${pn.strokes}</span><span class="grow">stage ${pn.stage}</span><button class="chip sm ${pn.stage === 'A' ? 'on' : ''}" data-act="penstage" data-i="${i}" data-s="A">A</button><button class="chip sm ${pn.stage === 'B' ? 'on' : ''}" data-act="penstage" data-i="${i}" data-s="B">B</button><button class="chip sm" data-act="pendel" data-i="${i}">✕</button></div>`).join('')}
        <div class="chips">${c.penaltyCodes.map(pc => `<button class="chip sm" data-act="penadd" data-c="${esc(pc.code)}" data-s="${pc.strokes}">+ ${esc(pc.code)}</button>`).join('')}</div></div>

      ${res.leakNeeded ? `<div class="card" style="border-color:#E6B8B4"><h2>Where did it leak?</h2><div class="mut small" style="margin-bottom:8px">${esc(leakInfo)}</div>
        <div class="fld"><div class="lab">Main leak</div>${leakChips('leak', inp.leak)}</div>
        ${c.leakMode !== 'single' ? `<div class="fld"><div class="lab">Contributing <span class="mut">optional</span></div>${leakChips('leak2', inp.leak2)}</div>` : ''}
        <div class="mut small">${c.leakCodes.map(l => l.code + ' ' + l.name).join(' · ')}</div></div>` : ''}

      ${!quick ? `<div class="fld"><div class="lab">Committed to every shot?</div><div class="chips">${[['yes', true], ['no', false], ['unsure', 'unsure']].map(([lab, v]) => `<button class="chip sm ${inp.commit === v ? 'on' : ''}" data-act="commit" data-v="${lab}">${lab}</button>`).join('')}</div></div>
        ${(c.customFields || []).map(f => `<div class="fld"><div class="lab">${esc(f.name)}</div>${f.type === 'yesno' ? `<div class="chips">${['yes', 'no'].map(v => `<button class="chip sm ${(inp.cf || {})[f.id] === v ? 'on' : ''}" data-act="cf" data-id="${f.id}" data-v="${v}">${v}</button>`).join('')}</div>` : `<input type="${f.type === 'number' ? 'number' : 'text'}" data-bind="in.cf.${f.id}" value="${esc((inp.cf || {})[f.id] ?? '')}">`}</div>`).join('')}
        <div class="fld"><div class="lab">Notes</div><input type="text" data-bind="in.notes" value="${esc(inp.notes || '')}"></div>` : ''}

      ${!inp.pickup ? `<button class="btn ghost small" data-act="pickup">Picked up / no return</button>` : ''}

      <div class="navrow"><button class="btn" data-act="hnav" data-d="-1" ${idx === 0 ? 'disabled' : ''}>‹ Prev</button>${idx === comp.holes.length - 1 ? `<button class="btn pri" data-act="nav" data-v="summary" data-id="${r.id}">Finish round</button>` : `<button class="btn pri" data-act="hnav" data-d="1">Next ›</button>`}</div>
      <div class="holegrid" style="margin-bottom:14px">${comp.holes.map((h, i) => `<button class="${i === idx ? 'cur' : (h.r.complete ? 'done' : '')}" data-act="nav" data-v="hole" data-id="${r.id}" data-n="${h.hole.n}">${h.hole.n}</button>`).join('')}</div>

      <div class="res"><div><div class="l">A</div><div class="t">${tick(res.aTick)}${res.penA ? '<span class="flag bad" style="margin-left:4px">P</span>' : ''}</div></div>
        <div><div class="l">B</div><div class="t">${tick(res.bTick)}${res.penB ? '<span class="flag bad" style="margin-left:4px">P</span>' : ''}</div></div>
        <div><div class="l">Score</div><div class="t">${res.pickup ? 'NR' : (res.score ?? '–')}</div></div>
        <div><div class="l">Pts</div><div class="t">${res.complete ? res.stableford : '–'}</div></div>
        <div><div class="l">vs tgt</div><div class="t">${res.complete && !res.pickup ? sgn(res.vsTarget, 0) : '–'}</div></div>
        ${res.sgA !== undefined ? `<div class="sg"><div class="l">SG A/B</div>${sgn(res.sgA)} / ${sgn(res.sgB)}</div>` : ''}
      </div>
      ${res.flags && res.flags.length ? `<div class="banner" style="margin-top:8px;background:#FCE8E6;color:var(--bad)">${res.flags.map(esc).join('<br>')}</div>` : ''}
    </div>`;
  }
  // ---------- GPS tap-to-mark ----------
  function holeGreen(r, n) {
    const h = r.holes.find(x => x.n == n); if (h && h.green) return h.green;
    const c = S.courses[r.courseId]; const ch = c && c.holes.find(x => x.n == n);
    return ch && ch.green ? ch.green : null;
  }
  function gpsRow(r, n, inp) {
    if (!('geolocation' in navigator)) return '';
    const g = holeGreen(r, n); const onGreen = inp.entryLie === 'G';
    return `<div class="gps">
      ${g && !onGreen ? `<button class="btn pri grow" data-act="gpsentry">📍 My ball is here</button>` : ''}
      <button class="btn ${g ? '' : 'grow'}" data-act="gpsgreen">${g ? 'Re-mark green' : '⛳ Mark green centre'}</button></div>
      <div class="mut small">${inp.entrySrc === 'gps' ? `<span class="flag ok">GPS ✓</span> entry measured${inp.entryPos && inp.entryPos.acc ? ' (±' + Math.round(inp.entryPos.acc / 0.9144) + ' yd)' : ''}. ` : ''}${g ? (onGreen ? 'On the green, enter the first putt in feet.' : 'Stand by your ball for the first shot in the zone and tap.') : 'Stand in the middle of this green once and tap. It is saved to the course for every future round.'}</div>`;
  }
  function getPos() {
    return new Promise((res, rej) => navigator.geolocation.getCurrentPosition(
      p => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      e => rej(e), { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 }));
  }
  function gpsError(e) {
    toast(e && e.code === 1 ? 'Location is blocked. Allow location for this site in your browser settings.' : 'Could not get a GPS fix. Try again in the open.');
  }
  async function gpsEntry() {
    const { r, inp, n } = curInp(); const g = holeGreen(r, n); if (!g) return;
    toast('Getting GPS fix…');
    try {
      const pos = await getPos();
      const yd = Math.round(TE.distanceYd(pos, g));
      if (yd > 600) return toast(`You are ${yd} yd from this green. Is this the right hole?`);
      inp.entryYd = yd; inp.entrySrc = 'gps'; inp.entryPos = pos;
      if (!inp.entryLie) inp.entryLie = 'F';
      toast(`Entry: ${yd} yd`);
      holeChanged();
    } catch (e) { gpsError(e); }
  }
  async function gpsGreen() {
    const { r, n } = curInp();
    toast('Getting GPS fix…');
    try {
      const pos = await getPos(); const g = { lat: pos.lat, lon: pos.lon, acc: pos.acc };
      const rh = r.holes.find(x => x.n == n); if (rh) rh.green = g;
      const c = S.courses[r.courseId]; const ch = c && c.holes.find(x => x.n == n);
      if (ch) { ch.green = g; save('course', c.id); }
      save('round', r.id);
      toast(`Green ${n} saved`);
      keepScroll();
    } catch (e) { gpsError(e); }
  }

  function cuesFor(r, n, comp, idx) {
    const cues = r.cfg.cues || []; if (!cues.length) return '';
    for (const c of cues) { const m = c.match(/^([\d,\s]+):\s*(.+)$/); if (m && m[1].split(',').map(s => +s.trim()).includes(+n)) return m[2]; }
    const prev = comp.holes[idx - 1];
    const general = cues.filter(c => !/^[\d,\s]+:/.test(c));
    if (prev && prev.r.complete && (prev.r.pickup || prev.r.vsTarget >= 2) && general.length) return general[(idx) % general.length];
    return '';
  }
  function curInp() {
    const r = S.rounds[V.args.id]; const n = V.args.n;
    r.entries[n] = r.entries[n] || {}; return { r, inp: r.entries[n], n };
  }
  function holeChanged(rerender = true) {
    const { r } = curInp();
    // auto pre-select leak when needed and not chosen
    const comp = computed(r); const x = comp.holes.find(h => h.hole.n == V.args.n);
    const inp = r.entries[V.args.n];
    if (x && x.r.leakNeeded && !inp.leak) {
      const st = x.r.worstStage;
      const pick = st === 'A' ? ((inp.penalties || []).length ? 'T' : (inp.tee && !['F', 'G'].includes(inp.tee) ? 'T' : 'AP')) : ((+inp.putts >= 3) ? 'P' : 'C');
      if (r.cfg.leakCodes.some(l => l.code === pick)) inp.leak = pick; else inp.leak = r.cfg.leakCodes[0]?.code;
      inp.leakAuto = true;
    }
    if (x && !x.r.leakNeeded && inp.leakAuto) { delete inp.leak; delete inp.leak2; delete inp.leakAuto; }
    save('round', r.id);
    if (rerender) { const y = window.scrollY; render(); window.scrollTo(0, y); }
  }
  function holeBind(key, v, live) {
    const { inp } = curInp();
    if (key.startsWith('cf.')) { inp.cf = inp.cf || {}; inp.cf[key.slice(3)] = v; }
    else if (['entryYd', 'firstPuttFt', 'prox'].includes(key)) { inp[key] = num(v) ?? ''; if (key === 'entryYd') { inp.entrySrc = inp.entryYd === '' ? '' : 'manual'; delete inp.entryPos; } }
    else inp[key] = v;
    holeChanged(!live);
    if (live) { // update the result bar without stealing focus
      const y = window.scrollY; const active = document.activeElement; const bind = active && active.dataset && active.dataset.bind; const pos = active && active.selectionStart;
      clearTimeout(S._liveT); S._liveT = setTimeout(() => { render(); window.scrollTo(0, y); if (bind) { const el = document.querySelector(`[data-bind="${bind}"]`); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) { } } } }, 600);
    }
  }

  // ---------- SUMMARY ----------
  function vSummary() {
    const r = S.rounds[V.args.id]; if (!r) return vHome();
    const comp = computed(r); const s = comp.summary; const c = r.cfg;
    const blockers = TE.closeBlockers(comp);
    const missing = comp.holes.filter(x => !x.r.complete).map(x => x.hole.n);
    const leakName = (code) => (c.leakCodes.find(l => l.code === code) || {}).name || code;
    const topLeaks = s.topLeaks.length ? s.topLeaks : (s.vsA >= s.vsB ? ['A'] : ['B']);
    const pct = (a, b) => b ? Math.round(100 * a / b) + '%' : '–';
    const sgLine = s.sgN ? `You ${s.sgA < 0 ? 'lost ' + fmt(-s.sgA) : 'gained ' + fmt(s.sgA)} shots getting to the zone and ${s.sgB < 0 ? 'lost ' + fmt(-s.sgB) : 'gained ' + fmt(s.sgB)} from the zone to the hole, against a ${bandName(r.baselineBand)} golfer (estimated baseline, ${s.sgN} holes).` : 'Add entry distances (full mode) to see strokes gained by stage.';
    return top('Round summary', 'home') + `<div class="wrap">
      <div class="hdr"><b>${esc(r.courseName)}</b><div class="mut small">${esc(r.date)} · PH ${r.ph} · ${esc(r.presetName)} · ${r.status === 'closed' ? 'closed' : 'open'}${(r.format || 'individual') !== 'individual' ? ' · ' + esc(r.format) + ' (not in stats)' : ''}</div></div>
      ${missing.length ? `<div class="banner">Holes not entered: ${missing.join(', ')}</div>` : ''}
      ${blockers.length ? `<div class="banner" style="background:#FCE8E6;color:var(--bad)">${blockers.map(esc).join('<br>')}</div>` : ''}
      <div class="stats">${stat(s.gross + (s.hasNR ? '*' : ''), 'Gross')}${stat(s.netExact ? fmt(s.gross - r.ph, 0) : '–', 'Net')}${stat(s.stableford, 'Stableford')}
        ${stat(s.aTicks + '/' + s.stagePlayed, 'A ✓ ' + pct(s.aTicks, s.stagePlayed))}${stat(s.bTicks + '/' + s.stagePlayed, 'B ✓ ' + pct(s.bTicks, s.stagePlayed))}${stat(sgn(s.vsNetPar, 0), 'vs net par')}
        ${stat(s.penalties, 'Penalties (' + s.penStrokes + ' str)')}${stat(s.netDoubles, 'Net doubles+')}${stat(s.threePutts, '3-putts')}
        ${stat(s.avgEntry !== null ? fmt(s.avgEntry, 0) : '–', 'Avg entry yd')}${stat(s.avgProx !== null ? fmt(s.avgProx, 0) : '–', 'Avg prox ft')}${stat(s.upDownN ? s.upDown + '/' + s.upDownN : '–', 'Up & down')}
        ${stat(s.quality === null ? '–' : s.quality + '%', 'Data quality')}</div>
      <div class="card" style="margin-top:12px"><h2>Where the shots went</h2><p>${esc(sgLine)}</p>
        <p class="mut small">Shots over stage targets: A +${s.vsA}, B +${s.vsB}.${s.stretch ? ' Stretch holes: ' + s.stretch + '.' : ''}${s.adjusted !== s.gross ? ' Adjusted gross for handicap: ' + s.adjusted + '.' : ''} Data quality ${s.quality ?? 0}%: ${s.qualityN} of ${s.stagePlayed} holes have a GPS entry distance and lie.${c.minQuality && (s.quality ?? 0) < c.minQuality ? ' This round is below your ' + c.minQuality + '% minimum, so it is left out of trend charts.' : ''}</p></div>
      <div class="card"><h2>Practice plan</h2>${topLeaks.map(l => `<div class="fld"><b>${esc(l)} — ${esc(leakName(l) || (l === 'A' ? 'Reaching the zone' : 'Zone to hole'))}</b>${s.leaks[l] ? `<span class="mut small"> · ${s.leaks[l].n} holes</span>` : ''}<div class="mut small">${esc(TE.DRILLS[l] || 'Pick a drill for this leak.')}</div></div>`).join('')}
        ${Object.keys(s.leaks).length ? `<div class="mut small">Leak tally: ${Object.entries(s.leaks).map(([k, v]) => k + ' ' + v.n + (v.contrib ? ' (+' + v.contrib + ')' : '')).join(' · ')}</div>` : ''}</div>
      <div class="card stack"><div><label class="f">Best thing today</label><input type="text" data-bind="rnd.best" value="${esc(r.best || '')}"></div><div><label class="f">One fix to practise</label><input type="text" data-bind="rnd.fix" value="${esc(r.fix || '')}"></div></div>
      <div class="card" style="padding:8px;overflow-x:auto"><table class="t"><tr><th>H</th><th>Par</th><th>Tgt</th><th>A</th><th>B</th><th>Sc</th><th>Pts</th><th>Leak</th><th>SG</th></tr>
      ${comp.holes.map(x => `<tr data-act="nav" data-v="hole" data-id="${r.id}" data-n="${x.hole.n}" style="cursor:pointer"><td><b>${x.hole.n}</b></td><td>${x.t.par}</td><td>${x.t.target}</td><td>${x.r.aTick === true ? '<span class="ok">✓</span>' : x.r.aTick === false ? '<span class="no">✗</span>' : ''}${x.r.penA ? '<sup class="no">P</sup>' : ''}</td><td>${x.r.bTick === true ? '<span class="ok">✓</span>' : x.r.bTick === false ? '<span class="no">✗</span>' : ''}${x.r.penB ? '<sup class="no">P</sup>' : ''}</td><td>${x.r.pickup ? 'NR' : (x.r.score ?? '')}</td><td>${x.r.complete ? x.r.stableford : ''}</td><td>${esc(x.inp.leak || '')}</td><td class="small">${x.r.sgA !== undefined ? sgn(x.r.sgA + x.r.sgB) : ''}</td></tr>`).join('')}</table></div>
      ${r.status === 'open' ? `<button class="btn pri block" data-act="closeround" data-id="${r.id}" ${blockers.length ? 'disabled' : ''}>Close round</button><button class="btn block" style="margin-top:10px" data-act="nav" data-v="hole" data-id="${r.id}" data-n="${missing[0] || comp.holes[0].hole.n}">Back to entry</button>`
        : `<button class="btn block" data-act="reopen" data-id="${r.id}">Re-open to edit</button>`}
      <button class="btn block" style="margin-top:10px" data-act="copysummary" data-id="${r.id}">Copy summary text</button>
      <button class="btn danger block" style="margin-top:10px" data-act="delround" data-id="${r.id}">Delete round</button>
    </div>`;
  }
  function summaryText(r) {
    const comp = computed(r), s = comp.summary;
    return `TEEOLOGY — ${r.courseName}, ${r.date}\nPH ${r.ph} · ${r.presetName}\nGross ${s.gross}${s.hasNR ? '*' : ''} · Stableford ${s.stableford} · vs net par ${sgn(s.vsNetPar, 0)}\nA ✓ ${s.aTicks}/${s.stagePlayed} · B ✓ ${s.bTicks}/${s.stagePlayed} · Penalties ${s.penalties} · Net doubles ${s.netDoubles} · 3-putts ${s.threePutts}\n` +
      (s.sgN ? `SG to zone ${sgn(s.sgA)} · SG zone to hole ${sgn(s.sgB)} (estimated baseline)\n` : '') +
      `Top leaks: ${s.topLeaks.join(', ') || '–'}\nBest: ${r.best || ''}\nFix: ${r.fix || ''}\n\n` +
      comp.holes.map(x => `${x.hole.n}: par ${x.t.par} tgt ${x.t.target} | A ${x.r.aTick ? '✓' : '✗'} B ${x.r.bTick ? '✓' : '✗'} | ${x.r.pickup ? 'NR' : x.r.score ?? '-'} (${x.r.stableford ?? '-'} pts)${x.inp.leak ? ' leak ' + x.inp.leak : ''}`).join('\n');
  }

  // ---------- HISTORY ----------
  function vHistory() {
    const rs = Object.values(S.rounds).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
    return top('Round history', 'home') + `<div class="wrap"><div class="card list">${rs.length ? rs.map(r => { const s = computed(r).summary; return `<div class="it" data-act="nav" data-v="${r.status === 'open' ? 'hole' : 'summary'}" data-id="${r.id}" data-n="${r.holes[0].n}"><span class="grow"><b>${esc(r.date)}</b> ${esc(r.courseName)}<div class="mut small">${s.gross}${s.hasNR ? '*' : ''} gross · ${s.stableford} pts · A ${s.aTicks}/${s.stagePlayed} · B ${s.bTicks}/${s.stagePlayed}${s.quality !== null ? ' · DQ ' + s.quality + '%' : ''}${r.status === 'open' ? ' · <b>open</b>' : ''}${(r.format || 'individual') !== 'individual' ? ' · ' + esc(r.format) : ''}</div></span>›</div>`; }).join('') : '<p class="mut">No rounds yet.</p>'}</div></div>`;
  }

  // ---------- TRENDS ----------
  function vTrends() {
    const p = S.profile; const c = p.cfg;
    const all = statsRounds().map(r => ({ r, comp: computed(r) }));
    const win = all.slice(-c.rollingWindow);
    const minS = c.minSample;
    const holesW = win.reduce((t, x) => t + x.comp.summary.stagePlayed, 0);
    const show = (n, v) => n >= minS ? v : `<span class="mut small">needs ${minS - n} more</span>`;
    const sumF = (f) => win.reduce((t, x) => t + (f(x.comp.summary) || 0), 0);
    const sgN = sumF(s => s.sgN);
    const curSig = TE.cfgSig(p.cfg);
    const sameSig = win.filter(x => x.r.cfgSig === curSig);
    const sigHoles = sameSig.reduce((t, x) => t + x.comp.summary.stagePlayed, 0);
    const adapt = TE.adaptiveSuggestion(all.map(x => ({ cfgSig: x.r.cfgSig, date: x.r.date + ' ' + x.r.createdAt, computed: x.comp })), Object.assign({}, p.cfg), p.changeLog.map(l => ({ date: l.stamp || l.date })), curSig);
    // leak ranking
    const leaks = {}; win.forEach(x => Object.entries(x.comp.summary.leaks).forEach(([k, v]) => { leaks[k] = leaks[k] || { n: 0, sg: 0, contrib: 0 }; leaks[k].n += v.n; leaks[k].sg += v.sg; leaks[k].contrib += v.contrib; }));
    const lk = Object.entries(leaks).sort((a, b) => b[1].n - a[1].n);
    // splits by par type
    const split = {}; win.forEach(x => x.comp.holes.forEach(h => { if (!h.r.complete || h.r.pickup) return; const k = 'Par ' + h.t.par; split[k] = split[k] || { n: 0, vs: 0, sgA: 0, sgB: 0, sgN: 0 }; split[k].n++; split[k].vs += h.r.score - h.t.netPar; if (h.r.sgA !== undefined) { split[k].sgA += h.r.sgA; split[k].sgB += h.r.sgB; split[k].sgN++; } }));
    const series = all.slice(-20);
    const selfCheck = selfRatingCheck(all, p);
    return top('Trends', 'home') + `<div class="wrap">
      <div class="hdr"><b>Last ${win.length} individual round${win.length === 1 ? '' : 's'}</b> <span class="mut small">(${holesW} holes; window ${c.rollingWindow >= 999 ? 'all' : c.rollingWindow})</span></div>
      ${all.length === 0 ? '<div class="card"><p class="mut">Close your first round to start seeing trends.</p></div>' : `
      <div class="card"><h2>Headline</h2><div class="stats">
        ${stat(show(holesW, sgn(sumF(s => s.vsNetPar) / win.length)), 'vs net par / round')}
        ${stat(show(sgN, sgn(sumF(s => s.sgA) / win.length)), 'SG to zone / round')}
        ${stat(show(sgN, sgn(sumF(s => s.sgB) / win.length)), 'SG zone→hole / round')}
        ${stat(show(holesW, fmt(sumF(s => s.netDoubles) / win.length)), 'Net doubles / round')}
        ${stat(show(holesW, fmt(sumF(s => s.penalties) / win.length)), 'Penalties / round')}
        ${stat(show(holesW, fmt(sumF(s => s.threePutts) / win.length)), '3-putts / round')}
        ${stat(show(sigHoles, sigHoles ? Math.round(100 * sameSig.reduce((t, x) => t + x.comp.summary.aTicks, 0) / sigHoles) + '%' : '–'), 'A ✓ (current preset)')}
        ${stat(show(sigHoles, sigHoles ? Math.round(100 * sameSig.reduce((t, x) => t + x.comp.summary.bTicks, 0) / sigHoles) + '%' : '–'), 'B ✓ (current preset)')}
        ${stat(show(sumF(s => s.upDownN), sumF(s => s.upDownN) ? Math.round(100 * sumF(s => s.upDown) / sumF(s => s.upDownN)) + '%' : '–'), 'Up & down')}
      </div><p class="mut small">Stats with fewer than ${minS} holes are hidden. Sample: ${holesW} holes, ${sgN} with strokes gained.</p></div>
      <div class="card"><h2>Score vs net par (per round)</h2>${spark(series.map(x => x.comp.summary.vsNetPar))}
        <h2 style="margin-top:10px">Strokes gained per round <span class="mut small">A solid · B dashed</span></h2>${spark(series.map(x => x.comp.summary.sgN ? x.comp.summary.sgA : null), series.map(x => x.comp.summary.sgN ? x.comp.summary.sgB : null))}</div>
      <div class="card"><h2>Target check</h2>${adaptHtml(adapt)}</div>
      <div class="card"><h2>Leak ranking</h2>${lk.length ? `<table class="t"><tr><th class="l">Leak</th><th>Main</th><th>Contrib</th><th>SG lost</th></tr>${lk.map(([k, v]) => `<tr><td class="l">${esc(k)} ${esc((c.leakCodes.find(l => l.code === k) || {}).name || '')}</td><td>${v.n}</td><td>${v.contrib}</td><td>${fmt(v.sg)}</td></tr>`).join('')}</table>` : '<p class="mut">No leaks recorded yet.</p>'}</div>
      <div class="card"><h2>By par type</h2><table class="t"><tr><th class="l">Type</th><th>Holes</th><th>vs net par</th><th>SG A</th><th>SG B</th></tr>${Object.entries(split).sort().map(([k, v]) => `<tr><td class="l">${k}</td><td>${v.n}</td><td>${v.n >= minS ? sgn(v.vs / v.n, 2) : '–'}</td><td>${v.sgN >= minS ? sgn(v.sgA / v.sgN, 2) : '–'}</td><td>${v.sgN >= minS ? sgn(v.sgB / v.sgN, 2) : '–'}</td></tr>`).join('')}</table><p class="mut small">Per hole. Hidden below ${minS} holes.</p></div>
      <div class="card"><h2>Self-rating check</h2>${selfCheck}</div>`}
    </div>`;
  }
  function adaptHtml(a) {
    if (a.status === 'collecting') return `<p class="mut">Collecting evidence: ${a.rounds}/${S.profile.cfg.evidenceRounds} rounds and ${a.holes}/${S.profile.cfg.evidenceHoles} holes at your current settings. Targets stay as they are until then.</p>`;
    if (a.status === 'cooldown') return `<p class="mut">Targets changed recently — next check in ${a.cooldownLeft} rounds.</p>`;
    if (a.status === 'steady') return `<p>Targets look right: A ${fmt(a.aPct, 0)}%, B ${fmt(a.bPct, 0)}% over ${a.holes} holes. No change.</p>`;
    return a.suggestions.map((s, i) => `<div class="fld"><p>${esc(s.text)}</p><button class="btn pri" data-act="applyadapt" data-i="${i}">Apply</button></div>`).join('') + '<p class="mut small">Applying logs the change and starts a cooldown.</p>';
  }
  function spark(a, b) {
    const vals = a.concat(b || []).filter(v => v !== null && v !== undefined);
    if (a.length < 2 || vals.length < 2) return '<p class="mut small">Needs 2+ rounds.</p>';
    const W = 300, H = 70, P = 6; const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); const rng = hi - lo || 1;
    const X = (i, n) => P + (W - 2 * P) * (n === 1 ? 0.5 : i / (n - 1)); const Y = v => H - P - (H - 2 * P) * (v - lo) / rng;
    const path = (arr) => arr.map((v, i) => v === null || v === undefined ? null : `${X(i, arr.length).toFixed(1)},${Y(v).toFixed(1)}`).filter(Boolean).join(' ');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="#ccc" stroke-dasharray="3 3"/><polyline fill="none" stroke="#1F4D3A" stroke-width="2.5" points="${path(a)}"/>${b ? `<polyline fill="none" stroke="#2E6B52" stroke-width="2" stroke-dasharray="5 4" points="${path(b)}"/>` : ''}</svg><div class="mut small">Last ${a.length} rounds · latest ${sgn(a[a.length - 1])}</div>`;
  }
  function selfRatingCheck(all, p) {
    if (all.length < 5) return `<p class="mut">After 5 rounds this compares your 1–5 ratings with what the data says. ${5 - all.length} to go.</p>`;
    const holes = all.flatMap(x => x.comp.holes.filter(h => h.r.complete && !h.r.pickup));
    const minS = p.cfg.minSample; const out = [];
    const sgBin = (lo, hi) => { const hs = holes.filter(h => h.r.sgB !== undefined && h.inp.entryLie !== 'G' && num(h.inp.entryYd) !== null && +h.inp.entryYd >= lo && +h.inp.entryYd < hi); return { n: hs.length, v: hs.length ? hs.reduce((t, h) => t + h.r.sgB, 0) / hs.length : 0 }; };
    const w = sgBin(50, 101), sh = sgBin(0, 50);
    const threeRate = holes.filter(h => h.r.threePutt).length / Math.max(1, holes.length) * 18;
    const penA = holes.reduce((t, h) => t + (h.r.penA || 0), 0) / all.length;
    const chk = (skill, cond, msg) => { if (cond) out.push(`<li>${esc(msg)}</li>`); };
    chk('wedges', w.n >= minS && p.skills.wedges >= 4 && w.v < -0.2, `You rate wedges ${p.skills.wedges}/5, but stage B from 50–100 yd averages ${sgn(w.v, 2)} per hole (${w.n} holes).`);
    chk('wedges', w.n >= minS && p.skills.wedges <= 2 && w.v > 0.1, `You rate wedges ${p.skills.wedges}/5, but stage B from 50–100 yd is ${sgn(w.v, 2)} per hole (${w.n} holes) — better than you think.`);
    chk('short', sh.n >= minS && p.skills.short >= 4 && sh.v < -0.2, `You rate short game ${p.skills.short}/5, but stage B inside 50 yd averages ${sgn(sh.v, 2)} per hole (${sh.n} holes).`);
    chk('lag', holes.length >= minS && p.skills.lag >= 4 && threeRate > 2, `You rate lag putting ${p.skills.lag}/5, but you average ${fmt(threeRate)} 3-putts per 18 holes.`);
    chk('drivAcc', holes.length >= minS && p.skills.drivAcc >= 4 && penA > 1, `You rate driving accuracy ${p.skills.drivAcc}/5, but average ${fmt(penA)} stage-A penalties per round.`);
    return out.length ? `<ul>${out.join('')}</ul>` : '<p class="mut">No mismatches between your ratings and your data.</p>';
  }

  // ---------- DATA ----------
  function vData() {
    return top('Data', 'home') + `<div class="wrap">
      <div class="card stack"><h2>Storage</h2><p class="mut small">${S.mode === 'cloud' ? 'Your data is backed up privately to your claude.ai account (only you can see it) and kept on this device for offline use.' : 'Your data is saved on this device only. Export a JSON backup regularly.'}</p></div>
      <div class="card stack"><h2>Export</h2>
        <button class="btn block" data-act="export" data-k="json">Full backup (JSON)</button>
        <button class="btn block" data-act="export" data-k="holes">Hole-by-hole data (CSV)</button>
        <button class="btn block" data-act="export" data-k="rounds">Round summaries (CSV)</button>
        <p class="mut small">If your browser blocks downloads here, the file is copied to your clipboard instead.</p></div>
      <div class="card stack"><h2>Restore</h2><p class="mut small">Load a JSON backup. Rounds and courses are merged (newer copies win).</p><input type="file" id="importFile" accept="application/json,.json"></div>
      <div class="card stack"><h2>Reset</h2><button class="btn danger block" data-act="wipe">Delete all data</button></div></div>`;
  }
  function csvHoles() {
    const head = ['round_id', 'date', 'course', 'preset', 'format', 'ph', 'hole', 'par', 'si', 'yards', 'strokes', 'target', 'zone_target', 'b_target', 'stretch', 'tee_club', 'tee', 'to_zone', 'entry_yd', 'entry_lie', 'zone_shots', 'putts', 'prox_ft', 'first_putt_ft', 'penalties', 'pickup', 'score', 'a_tick', 'b_tick', 'stableford', 'adjusted', 'sg_a', 'sg_b', 'leak', 'leak2', 'commit', 'notes'];
    const rows = [head];
    Object.values(S.rounds).forEach(r => computed(r).holes.forEach(x => rows.push([r.id, r.date, r.courseName, r.presetName, r.format, r.ph, x.hole.n, x.t.par, x.hole.si, x.hole.yards, x.t.strokes, x.t.target, x.t.zoneT, x.t.bT, x.t.stretch ? 1 : 0, x.inp.teeClub || '', x.inp.tee || '', x.inp.toZone ?? '', x.inp.entryYd ?? '', x.inp.entryLie || '', x.inp.zoneShots ?? '', x.inp.putts ?? '', x.inp.prox ?? '', x.inp.firstPuttFt ?? '', (x.inp.penalties || []).map(p => p.code + '/' + p.stage).join(' '), x.inp.pickup ? 1 : '', x.r.score ?? '', x.r.aTick === undefined || x.r.aTick === null ? '' : (x.r.aTick ? 1 : 0), x.r.bTick === undefined || x.r.bTick === null ? '' : (x.r.bTick ? 1 : 0), x.r.stableford ?? '', x.r.adjusted ?? '', x.r.sgA ?? '', x.r.sgB ?? '', x.inp.leak || '', x.inp.leak2 || '', x.inp.commit ?? '', x.inp.notes || ''])));
    return rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
  }
  function csvRounds() {
    const rows = [['round_id', 'date', 'course', 'preset', 'format', 'status', 'hi', 'ph', 'holes', 'gross', 'adjusted', 'stableford', 'vs_net_par', 'a_ticks', 'b_ticks', 'stage_holes', 'penalties', 'net_doubles', 'three_putts', 'sg_a', 'sg_b', 'sg_holes', 'top_leaks', 'best', 'fix']];
    Object.values(S.rounds).forEach(r => { const s = computed(r).summary; rows.push([r.id, r.date, r.courseName, r.presetName, r.format, r.status, r.hi, r.ph, s.holesDone, s.gross, s.adjusted, s.stableford, s.vsNetPar, s.aTicks, s.bTicks, s.stagePlayed, s.penalties, s.netDoubles, s.threePutts, s.sgN ? s.sgA.toFixed(2) : '', s.sgN ? s.sgB.toFixed(2) : '', s.sgN, s.topLeaks.join(' '), r.best || '', r.fix || '']); });
    return rows.map(r => r.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\n');
  }
  async function exportFile(kind) {
    const map = { json: ['teeology-backup-' + today() + '.json', JSON.stringify({ app: 'teeology', version: 1, exportedAt: new Date().toISOString(), profile: S.profile, courses: S.courses, rounds: S.rounds }, null, 1)], holes: ['teeology-holes-' + today() + '.csv', csvHoles()], rounds: ['teeology-rounds-' + today() + '.csv', csvRounds()] };
    const [filename, data] = map[kind];
    let dl = null; try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
    if (dl) { try { await dl.save({ filename, data }); return; } catch (e) { /* declined or failed: fall through */ } }
    try { await navigator.clipboard.writeText(data); toast('Copied to clipboard — paste into a file or email.'); } catch (e) { toast('Could not export here.'); }
  }
  function importJson(text) {
    let d; try { d = JSON.parse(text); } catch (e) { toast('Not a valid backup file.'); return; }
    if (!d || d.app !== 'teeology') { toast('Not a Teeology backup.'); return; }
    if (d.profile && (!S.profile || (d.profile.updatedAt || 0) > (S.profile.updatedAt || 0))) { S.profile = migrateProfile(d.profile); save('profile'); }
    Object.values(d.courses || {}).forEach(c => { if (!S.courses[c.id] || (c.updatedAt || 0) > (S.courses[c.id].updatedAt || 0)) { S.courses[c.id] = c; save('course', c.id); } });
    Object.values(d.rounds || {}).forEach(r => { if (!S.rounds[r.id] || (r.updatedAt || 0) > (S.rounds[r.id].updatedAt || 0)) { S.rounds[r.id] = r; save('round', r.id); } });
    toast('Backup restored.'); go('home');
  }

  // ================= ACTIONS =================
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
    const a = el.dataset.act; const d = el.dataset; const p = S.profile;
    switch (a) {
      case 'nav': {
        const args = {}; if (d.id) args.id = d.id; if (d.n) args.n = d.n;
        if (d.v === 'course' && d.new) args.draft = null;
        if (d.v === 'hole' && !args.n) { const r = S.rounds[args.id]; args.n = firstUnplayed(r, computed(r)); }
        if (d.v === 'start') Object.assign(args, { hi: p.hi });
        return go(d.v, args);
      }
      case 'tab': V.tab = d.t; return render();
      case 'skill': p.skills[d.k] = +d.v; save('profile'); return keepScroll();
      case 'setband': p.band = d.b; save('profile'); return render();
      case 'applyband': {
        const bp = TE.BAND_PRESETS[p.band];
        Object.assign(p.cfg, { zone: bp.zone, basis: bp.basis, bCeil: bp.bCeil, par3Rule: bp.par3Rule });
        if (p.cfg.bFloor > p.cfg.bCeil) p.cfg.bFloor = p.cfg.bCeil;
        save('profile'); toast('Band preset applied'); return render();
      }
      case 'savepreset': { const nm = ($('#presetName').value || '').trim(); if (!nm) return toast('Name the preset first'); p.presets[nm] = clone(p.cfg); save('profile'); toast('Preset saved'); return render(); }
      case 'loadpreset': p.cfg = Object.assign(TE.defaultConfig(), clone(p.presets[d.n])); save('profile'); toast('Now using ' + d.n); return render();
      case 'delpreset': delete p.presets[d.n]; save('profile'); return render();
      case 'savecourse': { const c = V.args.draft; c.updatedAt = Date.now(); S.courses[c.id] = clone(c); save('course', c.id); toast('Course saved'); return go(activeRound() ? 'home' : 'start', { courseId: c.id, hi: p.hi }); }
      case 'delcourse': return confirmBox('Delete this course? Past rounds keep their own copy of the holes.', 'Delete', () => { delete S.courses[d.id]; save('course', d.id); go('courses'); });
      case 'createround': return createRound();
      case 'resume': { const r = S.rounds[d.id]; return go('hole', { id: r.id, n: firstUnplayed(r, computed(r)) }); }
      case 'planedit': V.args.edit = V.args.edit == d.n ? null : d.n; return keepScroll();
      case 'delround': return confirmBox('Delete this round? This cannot be undone.', 'Delete', () => { delete S.rounds[d.id]; save('round', d.id); go('home'); });
      case 'mode': V.args.mode = d.m; return keepScroll();
      case 'set': { const { inp } = curInp(); if (d.f === 'leak' || d.f === 'leak2') delete inp.leakAuto; if (d.f === 'pickup') { inp.pickup = false; } else inp[d.f] = (inp[d.f] === d.v && d.f !== 'leak') ? '' : d.v; return holeChanged(); }
      case 'inc': case 'dec': {
        const { r, inp } = curInp(); const comp = computed(r); const x = comp.holes.find(h => h.hole.n == V.args.n);
        const def = d.f === 'toZone' ? x.t.zoneT : d.f === 'zoneShots' ? x.t.bT : 2;
        const cur = num(inp[d.f]);
        let v = cur === null ? def : cur + (a === 'inc' ? 1 : -1);
        v = Math.max(0, Math.min(15, v));
        inp[d.f] = v;
        if (d.f === 'zoneShots' && num(inp.putts) !== null && inp.putts > v) inp.putts = v;
        if (d.f === 'zoneShots' && num(inp.putts) === null && v >= 1 && !curRoundQuick()) { /* leave putts blank in full mode until tapped */ }
        if (d.f === 'toZone' && x.t.par === 3 && !inp.tee && v === 1 && x.t.par3Applies) { /* tee result needed: user picks */ }
        return holeChanged();
      }
      case 'penadd': { const { inp } = curInp(); inp.penalties = inp.penalties || []; inp.penalties.push({ code: d.c, strokes: +d.s, stage: num(inp.toZone) !== null && num(inp.zoneShots) !== null ? 'B' : 'A' }); return holeChanged(); }
      case 'penstage': { const { inp } = curInp(); inp.penalties[+d.i].stage = d.s; return holeChanged(); }
      case 'gpsentry': return gpsEntry();
      case 'gpsgreen': return gpsGreen();
      case 'pendel': { const { inp } = curInp(); inp.penalties.splice(+d.i, 1); return holeChanged(); }
      case 'commit': { const { inp } = curInp(); const v = d.v === 'yes' ? true : d.v === 'no' ? false : 'unsure'; inp.commit = inp.commit === v ? null : v; return holeChanged(); }
      case 'cf': { const { inp } = curInp(); inp.cf = inp.cf || {}; inp.cf[d.id] = inp.cf[d.id] === d.v ? '' : d.v; return holeChanged(); }
      case 'pickup': {
        const m = document.createElement('div'); m.className = 'modal';
        m.innerHTML = `<div class="sheet"><h2>Picked up — where was the ball?</h2><p class="mut small">Scores net double bogey, 0 Stableford points; left out of stage tick stats.</p><div class="row"><button class="btn grow" data-x="A">Outside the zone</button><button class="btn grow" data-x="B">In the zone</button></div><button class="btn ghost block" style="margin-top:8px" data-x="">Cancel</button></div>`;
        m.addEventListener('click', ev => { const x = ev.target.closest('[data-x]'); if (ev.target === m || x) { m.remove(); if (x && x.dataset.x) { const { inp } = curInp(); inp.pickup = true; inp.pickupStage = x.dataset.x; holeChanged(); } } });
        document.body.appendChild(m); return;
      }
      case 'hnav': {
        const r = S.rounds[V.args.id]; const hs = TE.roundHoles(r); const i = hs.findIndex(h => h.n == V.args.n) + (+d.d);
        if (i >= 0 && i < hs.length) go('hole', { id: r.id, n: hs[i].n, mode: V.args.mode }); return;
      }
      case 'closeround': {
        const r = S.rounds[d.id]; const comp = computed(r);
        const missing = comp.holes.filter(x => !x.r.complete).length;
        const doClose = () => { r.status = 'closed'; r.closedAt = Date.now(); if ((r.format || 'individual') === 'individual' && r.hi !== undefined) { /* keep index history */ p.hiHistory = p.hiHistory || []; } save('round', r.id); toast('Round closed'); go('summary', { id: r.id }); };
        if (missing) return confirmBox(`${missing} holes have no score. Close anyway? They will be left out.`, 'Close round', doClose);
        return doClose();
      }
      case 'reopen': S.rounds[d.id].status = 'open'; save('round', d.id); return render();
      case 'copysummary': navigator.clipboard.writeText(summaryText(S.rounds[d.id])).then(() => toast('Summary copied'), () => toast('Copy not allowed here')); return;
      case 'applyadapt': {
        const all = statsRounds().map(r => ({ cfgSig: r.cfgSig, date: r.date + ' ' + r.createdAt, computed: computed(r) }));
        const ad = TE.adaptiveSuggestion(all, p.cfg, p.changeLog.map(l => ({ date: l.stamp || l.date })), TE.cfgSig(p.cfg));
        const s = ad.suggestions && ad.suggestions[+d.i]; if (!s) return;
        const last = all[all.length - 1];
        Object.assign(p.cfg, s.change); p.changeLog.push({ date: today(), stamp: last ? last.date : today(), text: s.text, stage: s.stage, change: s.change });
        save('profile'); toast('Targets updated'); return render();
      }
      case 'export': return exportFile(d.k);
      case 'wipe': return confirmBox('Delete ALL profiles, courses and rounds from this device and your cloud backup?', 'Delete everything', () => {
        Object.keys(S.courses).forEach(k => { delete S.courses[k]; save('course', k); });
        Object.keys(S.rounds).forEach(k => { delete S.rounds[k]; save('round', k); });
        S.profile = defaultProfile(); save('profile'); go('home');
      });
    }
  });
  function curRoundQuick() { const r = S.rounds[V.args.id]; return (V.args.mode || r.cfg.entryMode) === 'quick'; }
  function keepScroll() { const y = window.scrollY; render(); window.scrollTo(0, y); }
  document.addEventListener('change', (e) => {
    if (e.target.id === 'importFile' && e.target.files[0]) { const fr = new FileReader(); fr.onload = () => importJson(fr.result); fr.readAsText(e.target.files[0]); }
  });

  // ================= BOOT =================
  function boot() {
    const d = lsLoad();
    S.profile = d && d.profile ? migrateProfile(d.profile) : defaultProfile();
    S.courses = (d && d.courses) || {}; S.rounds = (d && d.rounds) || {};
    render();
    initCloud();
    // Offline support when hosted as a standalone PWA (not inside a claude.ai artifact).
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.claude) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache unavailable */ });
    }
  }
  window.TeeologyApp = { S, V, render, go, computed, csvHoles };
  boot();
})();

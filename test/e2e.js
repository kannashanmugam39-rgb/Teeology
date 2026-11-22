// Phone-size run-through of a full 18-hole round against the built PWA, plus GPS marking and offline reload.
// Usage: python3 build.py && node test/e2e.js   (needs the `playwright` npm package and Chromium)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const dist = path.join(__dirname, '..', 'dist');
const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(dist, path.normalize(p));
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

const fails = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? ': ' + detail : ''}`); if (!ok) fails.push(name); };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const GREEN1 = { latitude: 51.5000, longitude: -0.1000 };
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, permissions: ['geolocation'], geolocation: GREEN1 });
  // Google Fonts are not reachable in every test sandbox; the app must not depend on them.
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push(String(e)));
  pg.on('console', m => { if (m.type() === 'error' && !/font|ERR_FAILED/i.test(m.text())) errors.push(m.text()); });

  await pg.goto(url); await pg.waitForTimeout(500);
  await pg.screenshot({ path: path.join(shots, '01-home.png') });
  check('manifest linked', await pg.locator('link[rel=manifest]').count() === 1);

  // profile
  await pg.click('text=1. Set up my profile');
  await pg.fill("[data-bind='profile.name']", 'Raj'); await pg.press("[data-bind='profile.name']", 'Tab');
  await pg.fill("[data-bind='profile.hi']", '21.4'); await pg.press("[data-bind='profile.hi']", 'Tab');
  await pg.click('[data-act=tab][data-t=bag]');
  await pg.fill("[data-bind='bag.T']", '200'); await pg.press("[data-bind='bag.T']", 'Tab');
  await pg.click('text=Done');

  // course
  // Sutton Green comes built in: pick the course, then switch tees and check the holes update
  await pg.click('text=Start a round');
  await pg.selectOption("[data-bind='start.courseName']", 'Sutton Green GC');
  const firstRow = async () => (await pg.locator('table.t tr').nth(3).innerText()).split(/\s+/).slice(1, 4).join(',');
  check('Sutton Green white: holes 1-3 yd', await firstRow() === '548,341,175', await firstRow());
  const phWhite = await pg.innerText('.hdr .big');
  await pg.click("[data-act=picktee]:has-text('Blue')");
  check('Sutton Green blue: holes 1-3 yd', await firstRow() === '519,316,166', await firstRow());
  const phBlue = await pg.innerText('.hdr .big');
  check('playing handicap changes with tee', phWhite !== phBlue, `white ${phWhite}, blue ${phBlue}`);
  await pg.selectOption("[data-bind='start.holesPlayed']", 'B9');
  check('back nine preview', (await pg.locator('table.t tr').first().innerText()).trim().startsWith('H\t10'));
  await pg.selectOption("[data-bind='start.holesPlayed']", '18');
  await pg.click("[data-act=picktee]:has-text('Red')");
  check('red tees need a rating before starting', await pg.isDisabled('[data-act=createround]'));
  await pg.click("[data-act=picktee]:has-text('White')");
  await pg.screenshot({ path: path.join(shots, '00-sutton-green.png'), fullPage: true });
  await pg.click('[data-act=nav][data-v=home]');

  // a course entered by hand
  await pg.click('text=Courses');
  await pg.click('text=+ Add course / tee');
  await pg.fill("[data-bind='course.name']", 'Test GC'); await pg.press("[data-bind='course.name']", 'Tab');
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5];
  const sis = [10, 2, 14, 6, 18, 4, 16, 8, 12, 9, 15, 1, 11, 5, 17, 13, 3, 7];
  const yds = [380, 400, 150, 500, 330, 420, 205, 390, 480, 370, 165, 430, 510, 360, 310, 140, 410, 470];
  for (let i = 0; i < 18; i++) {
    for (const [f, v] of [['par', pars[i]], ['si', sis[i]], ['yards', yds[i]]]) {
      const sel = `[data-bind='course.h.${i}.${f}']`;
      await pg.fill(sel, String(v)); await pg.dispatchEvent(sel, 'change');
    }
  }
  await pg.click('[data-act=savecourse]'); await pg.waitForTimeout(200);
  check('new course selected on start screen', (await pg.inputValue("[data-bind='start.courseName']")) === 'Test GC');
  check('playing handicap shown', /^\d+$/.test(await pg.innerText('.hdr .big')), await pg.innerText('.hdr .big'));
  await pg.click('[data-act=createround]');
  await pg.screenshot({ path: path.join(shots, '02-plan.png'), fullPage: true });
  await pg.click('text=Go to the 1st tee');

  const setstep = async (field, val) => {
    await pg.click(`[data-act=inc][data-f=${field}]`);
    let cur = parseInt(await pg.innerText(`.fld:has([data-f=${field}]) .v`), 10);
    while (cur < val) { await pg.click(`[data-act=inc][data-f=${field}]`); cur++; }
    while (cur > val) { await pg.click(`[data-act=dec][data-f=${field}]`); cur--; }
  };

  // (tee, toZone, entryLie, entryYd, zoneShots, putts, penalty)
  const plan = [['F', 2, 'F', 'gps', 3, 2, null], ['L', 3, 'R', 70, 4, 3, null], ['M', 1, 'S', 15, 3, 2, null], ['F', 3, 'F', 80, 3, 2, null],
    ['F', 2, 'G', null, 2, 2, null], ['R', 3, 'F', 60, 3, 2, 'W'], ['G', 1, 'G', null, 2, 2, null], ['F', 2, 'F', 95, 3, 2, null], ['F', 3, 'R', 40, 2, 1, null],
    ['F', 2, 'F', 100, 3, 2, null], ['N', 1, 'X', 10, 2, 1, null], ['S', 4, 'F', 70, 3, 2, null], ['F', 3, 'F', 85, 3, 2, null], ['F', 2, 'F', 60, 2, 1, null],
    ['F', 2, 'G', null, 2, 2, null], ['G', 1, 'G', null, 2, 2, null], ['L', 3, 'F', 50, 3, 2, 'OB'], ['F', 3, 'F', 75, 3, 2, null]];
  for (let h = 1; h <= plan.length; h++) {
    const [tee, tz, lie, yd, zs, pt, pen] = plan[h - 1];
    await pg.click(`[data-act=set][data-f=tee][data-v='${tee}']`);
    await setstep('toZone', tz);
    await pg.click(`[data-act=set][data-f=entryLie][data-v='${lie}']`);
    if (yd === 'gps') {
      // GPS: mark green 1 while standing on it, then walk ~90 yd south and tap "My ball is here"
      await pg.click('[data-act=gpsgreen]'); await pg.waitForSelector('[data-act=gpsentry]');
      await ctx.setGeolocation({ latitude: GREEN1.latitude - 90 * 0.9144 / 111195, longitude: GREEN1.longitude });
      await pg.click('[data-act=gpsentry]'); await pg.waitForSelector('.flag.ok');
      const got = await pg.inputValue("[data-bind='in.entryYd']");
      check('GPS entry distance ≈ 90 yd', Math.abs(+got - 90) <= 1, got);
      await pg.screenshot({ path: path.join(shots, '03-hole1-gps.png'), fullPage: true });
    } else if (lie === 'G') {
      await pg.fill("[data-bind='in.firstPuttFt']", '18'); await pg.dispatchEvent("[data-bind='in.firstPuttFt']", 'change');
    } else {
      await pg.fill("[data-bind='in.entryYd']", String(yd)); await pg.dispatchEvent("[data-bind='in.entryYd']", 'change');
    }
    await setstep('zoneShots', zs);
    await setstep('putts', pt);
    if (pen) {
      await pg.click(`[data-act=penadd][data-c='${pen}']`);
      await pg.click("[data-act=penstage][data-i='0'][data-s='A']");
    }
    if (h === 6) await pg.screenshot({ path: path.join(shots, '04-hole6.png'), fullPage: true });
    if (h < 18) await pg.click("[data-act=hnav][data-d='1']"); else await pg.click('text=Finish round');
  }
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: path.join(shots, '05-summary.png'), fullPage: true });
  const gross = await pg.innerText('.stats .stat:nth-child(1) .v');
  check('gross score', /^\d+$/.test(gross), gross);
  const dq = await pg.locator('.stat:has(.k:text("Data quality")) .v').innerText();
  // Only hole 1 used GPS for its entry distance, so 1 of 18 holes = 6%
  check('data quality shown', dq === '6%', dq);
  await pg.click('[data-act=closeround]'); await pg.waitForTimeout(200);
  await pg.click('[data-act=nav][data-v=home]');
  await pg.click('text=Trends');
  await pg.screenshot({ path: path.join(shots, '06-trends.png'), fullPage: true });
  const csv = await pg.evaluate('window.TeeologyApp.csvHoles()');
  check('CSV has 18 hole rows', csv.trim().split('\n').length === 19, csv.trim().split('\n').length);
  const greenSaved = await pg.evaluate('Object.values(window.TeeologyApp.S.courses).find(c => c.name === "Test GC").holes[0].green != null');
  check('green 1 saved to course', greenSaved);

  // offline: service worker cached the app, so it loads with no network
  await pg.evaluate('navigator.serviceWorker.ready');
  await pg.reload(); await pg.waitForTimeout(300);
  await ctx.setOffline(true);
  await pg.reload(); await pg.waitForTimeout(500);
  check('loads offline', await pg.locator('text=Last round').count() === 1);
  await pg.screenshot({ path: path.join(shots, '07-home-offline.png'), fullPage: true });

  await browser.close(); server.close();
  check('no page errors', errors.length === 0, JSON.stringify(errors));
  console.log(fails.length ? `${fails.length} failed` : 'all e2e checks passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });

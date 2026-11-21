# Teeology – phase 1 web app

A phone-first web app that replaces the paper Teeology card. Built against the Teeology App Specification v2.

## Layout

- `src/engine.js` is the scoring engine. It is made of pure functions with no UI and covers section 3 of the spec: handicap, hole targets, results, strokes gained, round stats and adaptive targets.
- `src/app.js` holds the screens (section 7) and storage.
- `src/app.css` is the stylesheet.
- `build.py` bundles everything into a single `dist/index.html`.
- `test/engine.test.js` runs spec acceptance cases 1–14 plus extras. Run it with `node test/engine.test.js`.
- `test/e2e.py` is a Playwright run-through of a full 18-hole round at phone size. Run it with `python3 test/e2e.py`.

## Storage

When the app runs as a claude.ai artifact, each user's data is stored privately at `data/users/<id>/` in the artifact database (`profile`, `c_<course>`, `r_<round>`). It is also mirrored to `localStorage` so it works offline. Outside claude.ai it falls back to `localStorage` only. Export and import are full JSON backups, plus CSV files for holes and rounds.

## What is in phase 1

- **Profile:** handicap index, band presets (5.1), skill ratings and bag distances. Every setting in section 4 can be changed, apart from those listed under "Not yet".
- **Named presets** that are snapshotted into each round.
- **Course library:** par, SI and yards for each hole, plus CR and slope for 18 holes and each 9.
- **Round setup:** WHS playing handicap, allowance, override, format tagging (team formats are left out of stats) and conditions.
- **Pre-round plan:** stretch flags, the par-3 rule marker, and per-hole tee club, zone, lay-up and offset.
- **Hole entry:** quick and full modes, steppers where the first tap sets the target, zone lies, penalties counted by stage, pick-up/NR, an auto-preselected leak with an optional contributing leak, commit, custom fields and swing cues.
- **Round summary:** results in plain English with strokes gained, a practice plan with drills, a close-round check (test 14), and copy-to-clipboard text.
- **Trends:** rolling window, minimum-sample hiding, sparklines, leak ranking, splits by par type, adaptive target suggestions with cooldown and log, and a self-rating check.

## Not yet (phase 2 or later)

- GPS tap-to-mark. Location is blocked inside claude.ai artifacts, so this needs a standalone PWA or a native app.
- Extra zone tiers and shot-by-shot mode.
- Personal baseline after 20+ rounds, and an imported baseline table.
- Voice entry, watch app, photo import, course data feed, group mode.

## Baseline warning

The strokes-gained tables are **estimates** (spec section 10, gap 1). Replace `BASE_YD`, `BASE_FT` and `BAND_MULT` in `engine.js` with licensed or pooled data before anything is released publicly.

## Going standalone

Host `dist/index.html` anywhere. The `claude.use(...)` calls return nothing outside claude.ai, and the app then uses `localStorage`. For a real PWA, add a manifest and a service worker, swap storage for IndexedDB with a backend such as Supabase or Firebase, and port `engine.js` to TypeScript. It is already a pure module with tests.

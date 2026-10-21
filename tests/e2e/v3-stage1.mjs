// E2E: v3 visitor journey + Stage 1 on the water (plain Node + Playwright Chromium).
//
// Usage:  node tests/e2e/v3-stage1.mjs              (starts `npx vite --port 5181 --strictPort` itself)
//         E2E_URL=http://localhost:5181 node tests/e2e/v3-stage1.mjs   (uses an already running server)
//
// Part A (1366×768, keyboard + mouse): Home → Nickname → Character select (12 portraits + 5 stat bars each) →
//   Pokémon select (18 portraits, ability text, cooldown) → Confirm → Tutorial (row / steer / glide / brake / Q / rescue)
//   → Stage 1: countdown, row ~3 taps/s while steering toward the dock, Hyde emerges (cinematic + skip hint), Hyde meter,
//   Esc pause freezes the clock, idle until caught → "THE HYDE HAS CAUGHT YOU! PRESS Q" (Esc cannot pause), Q resolves
//   it, caught again → DNF screen. Also audits the HUD keep-clear zones (UX_V3_ACTION §1 / checklist 1).
// Part B: two crew pairs through the dev shortcut `/?mode=play&character=..&pokemon=..&tutorial=0` — the selections
//   change stats, top speed and the ability in the debug state and the HUD; then ~5 taps/s over-pacing shows the
//   stamina "draining fast" warning and the one-shot "Steady strokes — mashing drains stamina" hint.
// Part C (1920×1080): HUD + rescue prompt legibility screenshots.
// V3_PARTS=A|B|C (any combination, default ABC) runs a subset.
//
// Time control: window.advanceTime(ms) runs fixed 1/60 s steps (keys held / tapped through Playwright are consumed by
// those steps) and window.render_game_to_text() returns { screen, view: { paused, countdown, … }, stage: debug }.
// Screenshots go to output/e2e-v3/*.png. Fails on any console error or page error.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 5181;
const BASE = process.env.E2E_URL ?? `http://localhost:${PORT}`;
const OUT = 'output/e2e-v3';
const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const CHARACTERS = ['wednesday', 'enid', 'xavier', 'bianca', 'ajax', 'eugene', 'yoko', 'divina', 'kent', 'rowan', 'morticia', 'gomez'];
const POKEMON_COUNT = 18;
const PARTS = process.env.V3_PARTS ?? 'ABC'; // e.g. V3_PARTS=C re-runs only the 1920×1080 part
mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
let server = null;
const t0 = Date.now();

function log(...args) {
  console.log(`[v3 ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...args);
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function startServer() {
  if (process.env.E2E_URL) return;
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error('Vite dev server did not start on port ' + PORT);
}

function stopServer() {
  if (!server) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true });
  else server.kill('SIGTERM');
}

function watchConsole(page, label) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`[${label}] console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => consoleErrors.push(`[${label}] pageerror: ${err.message}`));
}

async function state(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function advance(page, ms) {
  await page.evaluate((m) => window.advanceTime(m), ms);
}

async function waitScreen(page, name, timeout = 20000) {
  await page.waitForSelector(`[data-testid="screen-${name}"]`, { timeout });
  await sleep(650); // the 500 ms post-mount Enter/Space guard
  const s = await state(page);
  assert(s.screen === name, `expected screen ${name}, got ${s.screen}`);
  return s;
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000 }); // SwiftShader at 1920×1080 can be slow
  log('screenshot', `${OUT}/${name}.png`);
}

async function noScroll(page, label) {
  const m = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: window.innerHeight, sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  assert(m.sh <= m.ih + 1 && m.sw <= m.iw + 1, `${label} must fit the viewport without scrolling (${m.sw}×${m.sh} in ${m.iw}×${m.ih})`);
}

/** Waits (advancing the sim) until the countdown is over. */
async function waitCountdown(page) {
  await page.waitForSelector('[data-testid="screen-stage"]', { timeout: 20000 });
  await page.waitForFunction(() => {
    const s = JSON.parse(window.render_game_to_text());
    return s.screen === 'stage' && s.stage !== null && s.view && s.view.countdown === null;
  }, null, { timeout: 15000 });
  await sleep(100);
}

// ------------------------------------------------------------------------------------------------ steering

/** Signed angle (radians) from the boat's bow to the dock; forward is (-sin h, -cos h). */
function bearingError(st) {
  const b = st.boat;
  const f = st.course.finish;
  const want = Math.atan2(-(f.x - b.x), -(f.z - b.z)); // heading that points at the dock
  let d = want - b.heading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Rows for `simS` seconds at ~3 taps/s, steering toward the dock (A/D) and wriggling free when stuck on land.
 * `onTick(st)` runs after every tap; return true to stop early.
 */
async function rowFor(page, simS, ctx, onTick) {
  const TAP_MS = 333;
  const taps = Math.round((simS * 1000) / TAP_MS);
  let st = (await state(page)).stage;
  for (let i = 0; i < taps; i++) {
    if (st.status === 'rescue' || st.status === 'dnf' || st.status === 'finished') return st;
    let key = null;
    if (ctx.unstickTaps > 0) {
      ctx.unstickTaps--;
      key = ctx.unstickKey;
    } else {
      const err = bearingError(st);
      // heading grows counter-clockwise: A (left) increases it — sign learned on the first steer below.
      if (Math.abs(err) > 0.12) key = (err > 0) === ctx.aIncreasesHeading ? 'KeyA' : 'KeyD';
    }
    if (key) await page.keyboard.down(key);
    await page.keyboard.press('Space');
    await advance(page, key ? 160 : TAP_MS);
    if (key) {
      await page.keyboard.up(key);
      await advance(page, TAP_MS - 160);
    }
    const prevDock = st.distanceToDock;
    st = (await state(page)).stage;
    // Stuck (pinned on a shore, not closing on the dock): turn hard one way for ~1.3 s.
    if (st.boat.speed < 1.2 && st.t > 4 && prevDock - st.distanceToDock < 0.05 && ctx.unstickTaps === 0) {
      ctx.stuck++;
      if (ctx.stuck >= 3) {
        ctx.unstickKey = ctx.unstickKey === 'KeyA' ? 'KeyD' : 'KeyA';
        ctx.unstickTaps = 4;
        ctx.stuck = 0;
      }
    } else ctx.stuck = 0;
    if (onTick && (await onTick(st))) return st;
  }
  return st;
}

/** Learns which way A turns the boat (renderer/course independent). */
async function learnSteering(page) {
  const before = (await state(page)).stage.boat.heading;
  await page.keyboard.down('KeyA');
  await page.keyboard.press('Space');
  await advance(page, 400);
  await page.keyboard.up('KeyA');
  const after = (await state(page)).stage.boat.heading;
  let d = after - before;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  log(`steering: A changes heading by ${d.toFixed(3)} rad in 0.4 s`);
  assert(Math.abs(d) > 0.01, 'A must steer the boat');
  return { aIncreasesHeading: d > 0, unstickTaps: 0, unstickKey: 'KeyA', stuck: 0 };
}

// ------------------------------------------------------------------------------------------------ HUD checks

/** UX_V3_ACTION §1: in steady state no HUD panel intrudes on the centre 900×320 (y 130–450) or bottom-centre 560×220. */
async function auditKeepClear(page) {
  const res = await page.evaluate(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const s = W / 1366; // zones are specified at 1366×768
    const zones = [
      { name: 'centre', x: W / 2 - 450 * s, y: 130 * s, w: 900 * s, h: 320 * s },
      { name: 'bottom-centre', x: W / 2 - 280 * s, y: H - 220 * s, w: 560 * s, h: 220 * s },
    ];
    const sel = ['.ahud-objective', '.hyde-meter', '.ahud-chips', '.ahud-vitals', '.abil', '.ahud-keys'];
    const hits = [];
    const rects = {};
    for (const q of sel) {
      for (const el of document.querySelectorAll(q)) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || getComputedStyle(el).opacity === '0') continue;
        rects[q] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
        for (const z of zones) {
          const ix = Math.min(r.right, z.x + z.w) - Math.max(r.left, z.x);
          const iy = Math.min(r.bottom, z.y + z.h) - Math.max(r.top, z.y);
          if (ix > 1 && iy > 1) hits.push(`${q} overlaps ${z.name} by ${Math.round(ix)}×${Math.round(iy)}`);
        }
      }
    }
    return { hits, rects };
  });
  log('HUD rects', JSON.stringify(res.rects));
  assert(res.hits.length === 0, `HUD keep-clear zones: ${res.hits.join('; ')}`);
}

async function hudText(page, testId) {
  return page.evaluate((id) => document.querySelector(`[data-testid="${id}"]`)?.innerText ?? null, testId);
}

// ------------------------------------------------------------------------------------------------ Part A

async function selectionScreens(page) {
  await waitScreen(page, 'splash');
  await shot(page, '01-home');
  await page.keyboard.press('Enter');

  await waitScreen(page, 'nickname');
  await page.keyboard.type('Mia');
  await shot(page, '02-nickname');
  await page.keyboard.press('Enter');

  // ---- Character select: 12 cards, portraits loaded, 5 micro-bars each; the detail shows 5 stat meters.
  await waitScreen(page, 'character');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid^="character-"] img')].every((i) => i.complete), null, { timeout: 15000 });
  const cards = await page.evaluate(() =>
    [...document.querySelectorAll('[role="radio"][data-testid^="character-"]')].map((el) => {
      const img = el.querySelector('img');
      return {
        id: el.getAttribute('data-testid').slice('character-'.length),
        src: img?.getAttribute('src') ?? null,
        loaded: !!img && img.complete && img.naturalWidth > 0,
        bars: el.querySelectorAll('.micro-bar').length,
        name: el.querySelector('.ccard__name')?.textContent ?? '',
      };
    }),
  );
  assert(cards.length === 12, `12 characters expected, got ${cards.length}`);
  for (const c of cards) {
    assert(c.src === `/art/characters/${c.id}.webp`, `${c.id} portrait src ${c.src}`);
    assert(c.loaded, `${c.id} portrait must load`);
    assert(c.bars === 5, `${c.id} card shows ${c.bars} stat micro-bars, expected 5`);
    assert(c.name.length > 0, `${c.id} has a name`);
  }
  assert(CHARACTERS.every((id) => cards.some((c) => c.id === id)), 'every captain present');
  await noScroll(page, 'character select');
  for (const c of cards) {
    await page.click(`[data-testid="character-${c.id}"]`);
    const d = await page.evaluate(() => {
      const det = document.querySelector('[data-testid="detail-character"]');
      const meters = [...det.querySelectorAll('.seg-stat[role="meter"]')].map((m) => Number(m.getAttribute('aria-valuenow')));
      const img = det.querySelector('img');
      return { name: det.querySelector('h2')?.textContent, meters, trait: det.querySelector('.v3-detail__ability')?.textContent ?? '', img: img?.getAttribute('src') };
    });
    assert(d.name === c.name, `detail follows the selection (${d.name} vs ${c.name})`);
    assert(d.meters.length === 5 && d.meters.every((v) => v >= 1 && v <= 10), `${c.id} detail shows 5 stat bars 1–10, got ${d.meters}`);
    assert(d.meters.reduce((a, b) => a + b, 0) === 30, `${c.id} stats sum to 30, got ${d.meters}`);
    assert(d.trait.length > 0 && d.img === `/art/characters/${c.id}.webp`, `${c.id} detail has trait + portrait`);
    const s = await state(page);
    assert(s.draft.characterId === c.id, `click selects ${c.id}`);
  }
  await page.click('[data-testid="character-enid"]');
  await sleep(300);
  await shot(page, '03-character-select');
  await page.keyboard.press('Enter');

  // ---- Pokémon select: 18 cards with portraits; detail has ability name + text + cooldown.
  await waitScreen(page, 'pokemon');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid^="pokemon-"] img')].every((i) => i.complete), null, { timeout: 15000 });
  const mons = await page.evaluate(() =>
    [...document.querySelectorAll('[role="radio"][data-testid^="pokemon-"]')].map((el) => {
      const img = el.querySelector('img');
      return {
        id: el.getAttribute('data-testid').slice('pokemon-'.length),
        src: img?.getAttribute('src') ?? null,
        loaded: !!img && img.complete && img.naturalWidth > 0,
        type: el.querySelector('.type-chip')?.textContent ?? '',
      };
    }),
  );
  assert(mons.length === POKEMON_COUNT, `${POKEMON_COUNT} Pokémon expected, got ${mons.length}`);
  for (const p of mons) {
    assert(p.src === `/art/pokemon/${p.id}.webp` && p.loaded, `${p.id} portrait must load from /art/pokemon (src ${p.src})`);
    assert(p.type.length > 0, `${p.id} shows its type chip`);
  }
  await noScroll(page, 'Pokémon select');
  const abilityNames = new Set();
  for (const p of mons) {
    await page.click(`[data-testid="pokemon-${p.id}"]`);
    const d = await page.evaluate(() => {
      const det = document.querySelector('[data-testid="detail-pokemon"]');
      return {
        ability: det.querySelector('.v3-detail__ability')?.textContent ?? '',
        desc: det.querySelector('.v3-detail__desc')?.textContent ?? '',
        uses: det.querySelector('.v3-detail__uses')?.textContent ?? '',
        rescue: det.querySelector('.v3-detail__facts dd')?.textContent ?? '',
      };
    });
    assert(d.ability.length > 0 && d.desc.length > 10, `${p.id} detail shows ability name + text`);
    assert(/^(Cooldown [\d.]+ s|\d+ uses · [\d.]+ s)$/.test(d.uses), `${p.id} detail shows the cooldown, got "${d.uses}"`);
    assert(d.rescue.length > 0, `${p.id} detail shows the rescue effect`);
    abilityNames.add(d.ability);
  }
  assert(abilityNames.size === POKEMON_COUNT, 'every Pokémon has its own ability');
  await page.click('[data-testid="pokemon-gengar"]');
  await sleep(300);
  await shot(page, '04-pokemon-select');
  await page.click('[data-testid="btn-continue"]');

  await waitScreen(page, 'confirm');
  await shot(page, '05-confirm');
  await page.keyboard.press('Enter');
}

async function tutorial(page) {
  await page.waitForSelector('[data-testid="screen-tutorial"]', { timeout: 30000 });
  await page.waitForSelector('[data-testid="tutorial"][data-step="choose"]', { timeout: 15000 });
  await sleep(700);
  const s = await state(page);
  assert(s.screen === 'tutorial' && s.stage && s.stage.practice === true, 'tutorial runs a practice boat');
  await shot(page, '06-tutorial-choose');
  // Steps advance on real time (and auto-advance on timeout), so record every data-step change in the page itself.
  await page.evaluate(() => {
    window.__tutSteps = [];
    const el = document.querySelector('[data-testid="tutorial"]');
    const rec = () => {
      const step = el.getAttribute('data-step');
      if (window.__tutSteps.at(-1) !== step) window.__tutSteps.push(step);
    };
    rec();
    new MutationObserver(rec).observe(el, { attributes: true, attributeFilter: ['data-step'] });
  });
  await page.keyboard.press('Space'); // tap-to-row (default) + first stroke
  const seen = new Set();
  const deadline = Date.now() + 60000;
  let rescueShot = false;
  while (Date.now() < deadline) {
    const st = await state(page);
    if (st.screen !== 'tutorial') break;
    const step = await page.evaluate(() => document.querySelector('[data-testid="tutorial"]')?.getAttribute('data-step'));
    if (step && !seen.has(step)) {
      seen.add(step);
      log('tutorial step', step);
    }
    switch (step) {
      case 'row':
        await page.keyboard.press('Space');
        await sleep(300);
        if (!seen.has('row-shot') && (await state(page)).stage?.practice) {
          seen.add('row-shot');
          await shot(page, '07-tutorial-row');
        }
        break;
      case 'steer':
        await page.keyboard.press('Space');
        await page.keyboard.down('KeyA');
        await sleep(450);
        await page.keyboard.up('KeyA');
        await page.keyboard.down('KeyD');
        await sleep(450);
        await page.keyboard.up('KeyD');
        break;
      case 'glide':
        await page.keyboard.down('KeyW');
        await sleep(1300);
        await page.keyboard.up('KeyW');
        break;
      case 'brake':
        await page.keyboard.down('KeyS');
        await sleep(900);
        await page.keyboard.up('KeyS');
        break;
      case 'ability':
        await page.keyboard.press('KeyQ');
        // The staged rescue lasts 3 s of real time: wait for it directly rather than through the slow poll.
        if (!rescueShot && (await page.waitForSelector('[data-testid="hud-rescue"]', { timeout: 6000 }).catch(() => null))) {
          rescueShot = true;
          seen.add('rescue');
          await shot(page, '08-tutorial-rescue');
          await page.keyboard.press('KeyQ');
        }
        break;
      case 'rescue':
        if (!rescueShot) {
          rescueShot = true;
          if (await page.waitForSelector('[data-testid="hud-rescue"]', { timeout: 2500 }).catch(() => null)) await shot(page, '08-tutorial-rescue');
          else log('note: staged rescue step passed before its screenshot');
        }
        await page.keyboard.press('KeyQ');
        await sleep(500);
        break;
      default:
        await sleep(200);
    }
  }
  const recorded = await page.evaluate(() => window.__tutSteps ?? []).catch(() => []);
  log('tutorial steps (recorded in page)', JSON.stringify(recorded), 'handled', JSON.stringify([...seen]));
  for (const step of ['row', 'steer', 'glide', 'brake', 'ability', 'rescue']) assert(seen.has(step) || recorded.includes(step), `tutorial step ${step} was shown`);
  const after = await state(page);
  assert(after.screen === 'stage' && after.tutorialDone, `tutorial ends in Stage 1, got ${after.screen}`);
}

async function stageRun(page) {
  // ---- Countdown: Esc is ignored while it runs.
  await page.waitForSelector('[data-testid="screen-stage"]', { timeout: 15000 });
  if (await page.isVisible('[data-testid="countdown"]')) await shot(page, '09-countdown');
  else log('note: countdown already over (slow machine); it is screenshotted in part B');
  await page.keyboard.press('Escape');
  const cd = await state(page);
  if (cd.view.countdown !== null) assert(cd.view.paused === false, 'Esc does not pause during the countdown');
  else if (cd.view.paused) {
    log('note: countdown ended before Esc (slow machine); resuming');
    await page.keyboard.press('Escape');
  }
  await waitCountdown(page);
  const start = (await state(page)).stage;
  assert(start.practice === false && start.status === 'playing' && start.stats.strokes === 0 && start.t < 6, `Stage 1 starts fresh (t=${start.t}, strokes ${start.stats.strokes})`);
  log('course', JSON.stringify(start.course), 'dock', start.distanceToDock);

  // ---- Row ~3 taps/s while steering for the dock.
  const ctx = await learnSteering(page);
  let st = await rowFor(page, 8, ctx);
  log('after 8 s rowing', JSON.stringify({ t: st.t, speed: st.boat.speed, progress: st.progress, dock: st.distanceToDock, hyde: st.hyde.phase }));
  assert(st.boat.speed > 0, `speed > 0 while rowing, got ${st.boat.speed}`);
  assert(st.progress > start.progress, `progress increases (${start.progress} → ${st.progress})`);
  assert(st.stats.strokes >= 15, `strokes counted (${st.stats.strokes})`);
  const hudSpeed = await hudText(page, 'hud-speed');
  assert(/\d+\.\d\s*m\/s/.test(hudSpeed ?? ''), `HUD shows speed, got ${hudSpeed}`);
  await auditKeepClear(page);
  await shot(page, '10-rowing');

  // ---- Keep rowing until the Hyde wakes and emerges (cinematic + skip hint).
  let cinematicSeen = false;
  let progressMid = st.progress;
  st = await rowFor(page, 70, ctx, async (s) => {
    if (s.cinematic && !cinematicSeen) {
      cinematicSeen = true;
      const skip = await page.isVisible('[data-testid="hud-cinematic-skip"]');
      assert(skip, 'cinematic shows the [Space] Skip hint');
      await shot(page, '11-hyde-cinematic');
    }
    return s.hyde.phase !== 'dormant' && s.hyde.phase !== 'stalking' && s.hyde.phase !== 'emerging' && s.hyde.visibility > 0;
  });
  log('hyde emerged', JSON.stringify({ t: st.t, phase: st.hyde.phase, vis: st.hyde.visibility, gap: st.hyde.distance, progress: st.progress, cinematicSeen }));
  assert(st.hyde.phase !== 'dormant', `the Hyde wakes up (phase ${st.hyde.phase})`);
  assert(st.hyde.visibility > 0, `the Hyde is visible (visibility ${st.hyde.visibility})`);
  assert(st.t < 75, `the Hyde emerges within a reasonable time (t=${st.t})`);
  assert(st.progress > progressMid, 'progress keeps increasing');
  if (!cinematicSeen) log('note: hyde_reveal cinematic was skipped before a screenshot (a stroke skips it)');
  await page.waitForSelector('[data-testid="hud-hyde"]', { state: 'visible' });
  await advance(page, 100);
  await sleep(300);
  const meter = await page.evaluate(() => {
    const m = document.querySelector('[data-testid="hud-hyde"]');
    return { level: m.getAttribute('data-level'), gap: m.querySelector('[data-testid="hud-hyde-gap"]').textContent, word: m.querySelector('.hyde-meter__word').textContent, catches: m.querySelector('[data-testid="hud-catches"]').textContent, marker: !!m.querySelector('.hyde-meter__marker') };
  });
  log('hyde meter', JSON.stringify(meter));
  assert(/^(\d+ m|70\+ m)$/.test(meter.gap), `Hyde meter shows the gap, got "${meter.gap}"`);
  assert(meter.marker && meter.word !== 'Unseen', 'Hyde meter is active with a marker');
  assert(/0\/2/.test(meter.catches), `catches 0/2 shown, got "${meter.catches}"`);
  await shot(page, '12-hyde-meter');

  // ---- Esc pauses and the clock freezes (also against advanceTime); Esc resumes.
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="dialog-pause"]', { timeout: 3000 });
  const p1 = await state(page);
  assert(p1.view.paused === true, 'Esc pauses');
  await advance(page, 2000);
  await sleep(800);
  const p2 = await state(page);
  assert(p2.stage.t === p1.stage.t, `clock frozen while paused (${p1.stage.t} → ${p2.stage.t})`);
  await shot(page, '13-paused');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-testid="dialog-pause"]', { state: 'detached', timeout: 3000 });
  await advance(page, 300);
  const p3 = await state(page);
  assert(p3.view.paused === false && p3.stage.t > p2.stage.t, 'Esc resumes and the clock runs again');

  // ---- Idle until the Hyde catches us; the rescue prompt is urgent and Esc cannot pause.
  st = await idleUntil(page, (s) => s.status === 'rescue', 120);
  assert(st.status === 'rescue', `the Hyde catches an idle boat (status ${st.status}, t=${st.t}, gap ${st.hyde.distance})`);
  const caughtAt = Date.now();
  const prompt = await hudText(page, 'hud-rescue');
  assert(prompt && /THE HYDE HAS CAUGHT YOU!/.test(prompt) && /PRESS Q/.test(prompt), `rescue prompt reads "THE HYDE HAS CAUGHT YOU! PRESS Q…", got ${JSON.stringify(prompt)}`);
  await page.keyboard.press('Escape');
  await sleep(60);
  const r1 = await state(page);
  assert(r1.view.paused === false && r1.view.pauseDenied === true, 'Esc cannot pause during the rescue window');
  const catchesBefore = r1.stage.catches;
  // Q before any screenshot: the window is ~2 s and a SwiftShader screenshot can take longer (the prompt is
  // screenshotted on the next catch instead, where Q is deliberately not pressed).
  await page.keyboard.press('KeyQ');
  assert(r1.view.pauseDenied, 'the "Pause after the rescue" chip state is set');
  log(`Q pressed ${Date.now() - caughtAt} ms after the catch`);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).stage?.status !== 'rescue', null, { timeout: 8000 });
  const r2 = await state(page);
  log('rescue resolved', JSON.stringify({ status: r2.stage.status, catches: r2.stage.catches, rescues: r2.stage.stats.rescues, clean: r2.stage.stats.cleanEscapes, toast: r2.stage.toast }));
  assert(r2.stage.status === 'playing', `rescue resolves back to playing, got ${r2.stage.status}`);
  assert(r2.stage.stats.rescues + r2.stage.stats.cleanEscapes >= 1, 'Q rescued (rescued or clean escape)');
  assert(r2.stage.catches >= catchesBefore, 'catch counter consistent');
  await page.waitForSelector('[data-testid="hud-toast"]', { timeout: 3000 });
  await shot(page, '15-rescue-toast');
  const pips = await hudText(page, 'hud-catches');
  assert(pips.includes(`${r2.stage.catches}/2`), `catch pips show ${r2.stage.catches}/2, got ${pips}`);

  // ---- Caught again (no Q) until the run is over → DNF screen.
  let rescues = 0;
  const dnfDeadline = Date.now() + 240000;
  while (Date.now() < dnfDeadline) {
    st = await idleUntil(page, (s) => s.status === 'rescue' || s.status === 'dnf', 120);
    if (st.status === 'dnf') break;
    if (st.status === 'rescue') {
      rescues++;
      if (rescues === 1) {
        const p2 = await hudText(page, 'hud-rescue');
        await page.keyboard.press('Escape');
        assert(await page.isVisible('text=Pause after the rescue'), 'the "Pause after the rescue" chip shows');
        assert((await state(page)).view.paused === false, 'Esc cannot pause during the rescue window');
        log('second catch prompt', JSON.stringify(p2));
        await shot(page, '14-rescue-prompt-not-ready');
      }
      st = await idleUntil(page, (s) => s.status !== 'rescue', 10);
      log('catch without Q', JSON.stringify({ status: st.status, catches: st.catches }));
      if (st.status === 'dnf') break;
    } else break;
  }
  assert(st.status === 'dnf' && st.catches === 2, `second counted catch → DNF (status ${st.status}, catches ${st.catches})`);
  await shot(page, '17-dragged-into-fog');
  for (let i = 0; i < 20; i++) {
    if ((await state(page)).screen === 'dnf') break;
    await advance(page, 300);
  }
  const end = await waitScreen(page, 'dnf');
  assert(end.result && end.result.outcome === 'dnf' && end.result.catches === 2, 'DNF result recorded');
  const text = await page.evaluate(() => document.querySelector('[data-testid="screen-dnf"]').innerText);
  assert(/Dragged into/i.test(text) && /unranked/i.test(text), `DNF screen copy, got ${JSON.stringify(text.slice(0, 200))}`);
  await noScroll(page, 'DNF screen');
  await shot(page, '18-dnf-screen');
}

/** Advances the sim with no input (200 ms chunks) until `pred(stage)` or `maxS` sim seconds pass. */
async function idleUntil(page, pred, maxS) {
  let st = (await state(page)).stage;
  const until = st.t + maxS;
  while (!pred(st) && st.t < until) {
    await advance(page, 200);
    st = (await state(page)).stage;
    if (!st) break;
  }
  return st;
}

// ------------------------------------------------------------------------------------------------ Part B

async function pairRun(browser, characterId, pokemonId, label) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  watchConsole(page, `pair ${characterId}+${pokemonId}`);
  await page.goto(`${BASE}/?mode=play&character=${characterId}&pokemon=${pokemonId}&tutorial=0`);
  await page.waitForSelector('[data-testid="countdown"]', { timeout: 20000 });
  await shot(page, `${label}-countdown`);
  await waitCountdown(page);
  const s0 = await state(page);
  assert(s0.screen === 'stage' && s0.draft.characterId === characterId && s0.draft.pokemonId === pokemonId, 'shortcut skips selection and tutorial');
  // Identical input for both pairs: 12 taps at 3 taps/s, no steering.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Space');
    await advance(page, 333);
  }
  const s = (await state(page)).stage;
  const hudAbility = await page.evaluate(() => document.querySelector('.abil__name')?.textContent);
  const hudImg = await page.evaluate(() => document.querySelector('[data-testid="hud-ability"] img')?.getAttribute('src'));
  await shot(page, label);
  await context.close();
  return { crew: s.crew, ability: s.ability, speed: s.boat.speed, stamina: s.boat.stamina, hp: s.boat.hp, hudAbility, hudImg };
}

/** Over-pacing (D-23): ~5 taps/s drains stamina faster than it recovers → the bar warns + a one-shot hint. */
async function overpace(browser) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  watchConsole(page, 'overpace');
  await page.goto(`${BASE}/?mode=play&character=gomez&pokemon=gengar&tutorial=0`);
  await waitCountdown(page);
  let hintSeen = false;
  let fastSeen = false;
  for (let i = 0; i < 100 && !(hintSeen && fastSeen); i++) {
    await page.keyboard.press('Space');
    await advance(page, 200);
    if (i % 5 !== 4) continue;
    const ui = await page.evaluate(() => ({
      trend: document.querySelector('[data-testid="hud-stamina"]')?.getAttribute('data-trend'),
      word: document.querySelector('[data-testid="hud-stamina-word"]')?.textContent ?? null,
      msg: document.querySelector('[data-testid="hud-message"]')?.textContent ?? null,
    }));
    if (ui.trend === 'draining_fast' && ui.word && !fastSeen) {
      fastSeen = true;
      log('stamina warning', JSON.stringify(ui));
    }
    if (ui.msg && /mashing drains stamina/i.test(ui.msg) && !hintSeen) {
      hintSeen = true;
      log('over-pacing hint', JSON.stringify(ui), 'stamina', (await state(page)).stage.boat.stamina);
      await shot(page, '23-overpace-hint');
    }
  }
  assert(fastSeen, 'fast tapping shows the stamina bar "draining fast" warning');
  assert(hintSeen, 'fast tapping shows the one-shot "Steady strokes — mashing drains stamina" hint');
  await context.close();
}

// ------------------------------------------------------------------------------------------------ Part C

async function bigScreen(browser) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  watchConsole(page, 'hud 1920');
  await page.goto(`${BASE}/?mode=play&character=wednesday&pokemon=sableye&tutorial=0`);
  await waitCountdown(page);
  const ctx = await learnSteering(page);
  const st = await rowFor(page, 70, ctx, async (s) => s.hyde.phase !== 'dormant' && s.hyde.phase !== 'stalking' && s.hyde.phase !== 'emerging' && !s.cinematic);
  assert(st.hyde.visibility > 0, '1920: Hyde out');
  await advance(page, 100);
  await sleep(300);
  await auditKeepClear(page);
  await shot(page, '21-hud-1920');
  const r = await idleUntil(page, (s) => s.status === 'rescue', 120);
  assert(r.status === 'rescue', '1920: caught');
  await shot(page, '22-rescue-1920');
  await context.close();
}

// ------------------------------------------------------------------------------------------------ main

async function partA(browser) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();
  watchConsole(page, 'journey 1366');
  await page.goto(BASE);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  assert((await page.evaluate(() => typeof window.advanceTime)) === 'function', 'advanceTime hook');
  assert((await state(page)).mode === 'v3', '/ is the v3 journey');
  await selectionScreens(page);
  await tutorial(page);
  await stageRun(page);
  await context.close();
}

async function partB(browser) {
  const a = await pairRun(browser, 'gomez', 'dragapult', '19-pair-gomez-dragapult');
  const b = await pairRun(browser, 'kent', 'aegislash', '20-pair-kent-aegislash');
  log('pair A', JSON.stringify(a));
  log('pair B', JSON.stringify(b));
  assert(JSON.stringify(a.crew.stats) !== JSON.stringify(b.crew.stats), 'different captains → different stats');
  assert(a.crew.maxSpeed !== b.crew.maxSpeed, `different top speed (${a.crew.maxSpeed} vs ${b.crew.maxSpeed})`);
  assert(a.crew.maxHp !== b.crew.maxHp || a.crew.maxStamina !== b.crew.maxStamina || a.crew.multipliers.damageTaken !== b.crew.multipliers.damageTaken, 'toughness/stamina differ');
  assert(a.ability.name !== b.ability.name && a.ability.specialty !== b.ability.specialty, 'different Pokémon → different ability');
  assert(a.hudAbility === a.ability.name && b.hudAbility === b.ability.name, 'HUD ability panel follows the Pokémon');
  assert(a.hudImg === '/art/pokemon/dragapult.webp' && b.hudImg === '/art/pokemon/aegislash.webp', 'HUD medallion follows the Pokémon');
  assert(Math.abs(a.speed - b.speed) > 0.05, `same input, different boat speed (${a.speed} vs ${b.speed})`);
  await overpace(browser);
}

async function main() {
  await startServer();
  const browser = await chromium.launch({ args: CHROME_ARGS });
  try {
    if (PARTS.includes('A')) await partA(browser);
    if (PARTS.includes('B')) await partB(browser);
    if (PARTS.includes('C')) await bigScreen(browser);
  } finally {
    await browser.close();
    stopServer();
  }

  if (consoleErrors.length) {
    console.error('[v3] console errors:\n' + consoleErrors.join('\n'));
    process.exit(1);
  }
  log(`PASS (parts ${PARTS})`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[v3] FAIL', err);
  if (consoleErrors.length) console.error('[v3] console errors:\n' + consoleErrors.join('\n'));
  stopServer();
  process.exit(1);
});

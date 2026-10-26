// E2E smoke test (plain Node + Playwright Chromium).
//
// Usage:  node tests/e2e/smoke.mjs              (starts `npx vite --port 5180 --strictPort` itself)
//         E2E_URL=http://localhost:5180 node tests/e2e/smoke.mjs   (uses an already running server)
// The legacy v2.5 race runs at `/?legacy=1` (LOCAL DEMO; plain `/` is the v3 journey, covered by v3-stage1.mjs).
// Board assertions use `?mode=dashboard&legacy=1&demo=1` (the v2.5 demo board; `demo=1` alone is now the mystery
// dashboard); plain `?mode=dashboard` is
// live when .env is configured, so it is only screenshotted (its console errors are reported, not failed on).
//
// Plays one full legacy LOCAL DEMO race with keyboard + mouse (splash -> nickname -> captain -> Pokemon -> confirm ->
// 3 legs with skipped animations -> final), asserts through window.render_game_to_text(), captures screenshots
// to output/e2e/*.png and fails on any console error or page error.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 5180;
const BASE = process.env.E2E_URL ?? `http://localhost:${PORT}`;
const OUT = 'output/e2e';
const LEGACY = `${BASE}/?legacy=1`;
const CHROME_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
mkdirSync(OUT, { recursive: true });

const consoleErrors = [];
const toleratedErrors = [];
let server = null;

function log(...args) {
  console.log('[e2e]', ...args);
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

/** `tolerated` pages (the live dashboard against a backend that may not be deployed) only log their errors. */
function watchConsole(page, label, tolerated = false) {
  const sink = tolerated ? toleratedErrors : consoleErrors;
  page.on('console', (msg) => {
    if (msg.type() === 'error') sink.push(`[${label}] console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => sink.push(`[${label}] pageerror: ${err.message}`));
}

async function state(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function waitScreen(page, name, timeout = 15000) {
  await page.waitForSelector(`[data-testid="screen-${name}"]`, { timeout });
  // Respect the 500 ms post-mount Enter/Space guard.
  await sleep(650);
  const s = await state(page);
  assert(s.screen === name, `expected screen ${name}, got ${s.screen}`);
  return s;
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  log('screenshot', `${OUT}/${name}.png`);
}

async function freshTerminal(browser, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  watchConsole(page, `terminal ${viewport.width}x${viewport.height}`);
  await page.goto(LEGACY);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  return { context, page };
}

async function crewUp(page, nickname, { capture }) {
  await waitScreen(page, 'splash');
  if (capture) await shot(page, '01-splash');
  await page.keyboard.press('Enter');

  await waitScreen(page, 'nickname');
  await page.keyboard.type(nickname);
  await page.keyboard.press('Enter');

  await waitScreen(page, 'captain');
  // Keyboard: arrow from the heading into the grid, then pick Eugene (index 9) with arrows, Enter continues.
  await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
  const afterArrows = await state(page);
  assert(afterArrows.draft.characterId === 'eugene', `arrow navigation should select eugene, got ${afterArrows.draft.characterId}`);
  if (capture) await shot(page, '02-captain-select');
  await page.keyboard.press('Enter');

  await waitScreen(page, 'pokemon');
  // Mouse: click Sableye, then Continue.
  await page.click('[data-testid="pokemon-sableye"]');
  if (capture) await shot(page, '03-pokemon-select');
  await page.click('[data-testid="btn-continue"]');

  await waitScreen(page, 'confirm');
  if (capture) await shot(page, '04-confirm');
  await page.keyboard.press('Enter');
}

async function waitForAdvice(page) {
  try {
    await page.waitForSelector('[data-testid="advice-headline"]', { timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

async function playLeg(page, leg) {
  const s = await waitScreen(page, 'decision');
  assert(s.race.leg === leg, `decision HUD should show leg ${leg}, got ${s.race.leg}`);
  assert(s.race.status === 'in_progress', 'race should be in progress');
  assert(s.visibleOffers && s.visibleOffers.safe && s.visibleOffers.shortcut, 'Eugene must see both routes’ eggs before choosing');
  assert(Array.isArray(s.pushOptions) && s.pushOptions.length === 3, 'three push options');
  const hasAdvice = await waitForAdvice(page);
  if (leg === 1) await shot(page, '05-decision-hud');

  // Set sail is disabled until a route is chosen: pressing Enter must not leave the HUD.
  await page.keyboard.press('Enter');
  await sleep(300);
  assert((await state(page)).screen === 'decision', 'Enter without a route must not sail');

  if (hasAdvice) await page.keyboard.press('a');
  else await page.keyboard.press('s');
  await sleep(150);
  const chosen = await state(page);
  assert(chosen.selection.route, 'a route should be selected after A/S');
  await sleep(500);
  if (leg === 1) await shot(page, '06-decision-hud-selected');
  await page.keyboard.press('Enter');

  const egg = await waitScreen(page, 'egg');
  const route = chosen.selection.route;
  const tier = egg.visibleOffers?.[route];
  assert(tier, 'egg tier visible after prepare');
  await page.waitForSelector('[data-testid="egg-advice"] strong', { timeout: 8000 }).catch(() => undefined);
  if (leg === 1) await shot(page, '07-egg-reveal');
  await page.keyboard.press(tier === 'none' ? 'k' : 'c');

  await waitScreen(page, 'cinematic');
  await sleep(900);
  if (leg === 1) await shot(page, '08-cinematic');
  const cine = await state(page);
  log(`leg ${leg} scene`, JSON.stringify(cine.scene));
  await page.waitForSelector('[data-testid="btn-skip-animation"]', { timeout: 5000 });
  await page.click('[data-testid="btn-skip-animation"]');

  const result = await waitScreen(page, 'result');
  assert(result.lastLeg && result.lastLeg.leg === leg, 'leg result belongs to this leg');
  await page.waitForSelector('[data-testid="waterfall"]');
  await sleep(400);
  if (leg === 1) await shot(page, '09-leg-result');
  log(`leg ${leg}:`, JSON.stringify(result.lastLeg));
  await page.keyboard.press('Enter');
  return result.lastLeg.outcome;
}

async function main() {
  await startServer();
  const browser = await chromium.launch({ args: CHROME_ARGS });
  try {
    // ---------- Full race at 1366x768 ----------
    const { context, page } = await freshTerminal(browser, { width: 1366, height: 768 });
    assert(typeof (await page.evaluate(() => typeof window.advanceTime)) === 'string', 'advanceTime hook');
    await crewUp(page, 'Mia', { capture: true });
    let outcome = 'survived';
    for (let leg = 1; leg <= 3 && outcome === 'survived'; leg++) outcome = await playLeg(page, leg);

    const final = await waitScreen(page, 'final');
    assert(['completed', 'dnf'].includes(final.race.status), `final status ${final.race.status}`);
    await sleep(1600);
    await shot(page, '10-final');
    log('final:', JSON.stringify(final.race));
    // Next visitor is guarded for 2 s, then returns to the splash.
    await sleep(600);
    await page.click('[data-testid="btn-next-visitor"]');
    await waitScreen(page, 'splash');

    // ---------- Dashboard (same browser storage) ----------
    const dash = await context.newPage();
    watchConsole(dash, 'dashboard');
    await dash.setViewportSize({ width: 1366, height: 768 });
    await dash.goto(`${BASE}/?mode=dashboard&legacy=1&demo=1`);
    await dash.waitForSelector('[data-testid="screen-dashboard"]');
    await sleep(800);
    const board = await state(dash);
    log('dashboard:', JSON.stringify(board));
    if (final.race.status === 'completed') {
      assert(board.leaderboard.some((r) => r.nickname === 'Mia'), 'finished racer appears on the demo leaderboard');
    } else {
      assert(board.defeated >= 1, 'DNF racer appears in the defeated log');
    }
    await shot(dash, '11-dashboard');
    await dash.click('[data-testid="btn-operator"]');
    await dash.waitForSelector('[data-testid="operator-drawer"]');
    await sleep(400);
    await shot(dash, '12-dashboard-operator');
    await context.close();

    // ---------- Plain ?mode=dashboard: live when configured; must degrade clearly, never blank ----------
    const liveCtx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const livePage = await liveCtx.newPage();
    watchConsole(livePage, 'dashboard-live', true);
    await livePage.goto(`${BASE}/?mode=dashboard&legacy=1`);
    await livePage.waitForSelector('[data-testid="screen-dashboard"], [data-testid="screen-gate"]', { timeout: 15000 });
    await sleep(4000);
    const liveText = await livePage.evaluate(() => document.body.innerText.trim().length);
    assert(liveText > 40, 'live dashboard must render readable content, not a blank page');
    await shot(livePage, '16-dashboard-live-mode');

    // Live station URL: only screenshot the sign-in gate. Never sign in or create live sessions from the smoke.
    const stationPage = await liveCtx.newPage();
    watchConsole(stationPage, 'station-live', true);
    await stationPage.goto(`${BASE}/?mode=terminal&station=station_a&legacy=1`);
    await stationPage.waitForSelector('[data-testid="screen-gate"], [data-testid="screen-splash"]', { timeout: 15000 });
    await sleep(1000);
    const gate = await stationPage.$('[data-testid="screen-gate"]');
    log(gate ? 'live station shows the sign-in gate' : 'live station already signed in (unexpected in a fresh context)');
    assert(await stationPage.$('[data-testid="btn-play-local"]') || !gate, 'gate offers an explicit LOCAL DEMO choice');
    await shot(stationPage, '17-station-live-signin');
    await liveCtx.close();

    // ---------- Decision HUD at 1920x1080 ----------
    const big = await freshTerminal(browser, { width: 1920, height: 1080 });
    await crewUp(big.page, 'Leo', { capture: false });
    await waitScreen(big.page, 'decision');
    await waitForAdvice(big.page);
    await big.page.keyboard.press('h');
    await sleep(800);
    await shot(big.page, '13-decision-hud-1920');

    // Operator reset from the dashboard tab ends the terminal's race with a clear notice.
    const dash2 = await big.context.newPage();
    watchConsole(dash2, 'dashboard-reset');
    await dash2.goto(`${BASE}/?mode=dashboard&legacy=1&demo=1`);
    await dash2.click('[data-testid="btn-operator"]');
    await dash2.click('[data-testid="btn-reset-demo"]');
    await dash2.click('[data-testid="confirm-ok"]');
    await big.page.bringToFront();
    const reset = await waitScreen(big.page, 'splash');
    assert(reset.notice && /reset by the operator/i.test(reset.notice), `operator reset notice expected, got ${reset.notice}`);
    await shot(big.page, '14-reset-by-operator');
    await big.context.close();

    // ---------- No WebGL: 2D fallback stays playable; reload restores the canonical session ----------
    const noGl = await chromium.launch({ args: ['--disable-webgl', '--disable-3d-apis'] });
    try {
      const flat = await freshTerminal(noGl, { width: 1366, height: 768 });
      await flat.page.waitForSelector('[data-testid="webgl-fallback"]', { timeout: 10000 });
      await crewUp(flat.page, 'Ada', { capture: false });
      await waitScreen(flat.page, 'decision');
      await flat.page.keyboard.press('s');
      await flat.page.reload();
      const restored = await waitScreen(flat.page, 'decision');
      assert(restored.race.leg === 1 && restored.race.revision === 0, 'reload restores the active session at the decision HUD');
      await flat.page.keyboard.press('s');
      await flat.page.keyboard.press('Enter');
      const egg = await waitScreen(flat.page, 'egg');
      await flat.page.keyboard.press(egg.visibleOffers.safe === 'none' ? 'k' : 'c');
      await waitScreen(flat.page, 'cinematic');
      await flat.page.waitForSelector('[data-testid="fallback-race"]');
      await sleep(2200);
      await shot(flat.page, '15-cinematic-2d-fallback');
      await flat.page.click('[data-testid="btn-skip-animation"]');
      await waitScreen(flat.page, 'result');
      await flat.context.close();
    } finally {
      await noGl.close();
    }
  } finally {
    await browser.close();
    stopServer();
  }

  if (consoleErrors.length) {
    console.error('[e2e] console errors:\n' + consoleErrors.join('\n'));
    process.exit(1);
  }
  if (toleratedErrors.length) log(`tolerated live-dashboard errors (backend not deployed?): ${toleratedErrors.length}`);
  log('PASS');
  // The spawned dev server's pipes would otherwise keep Node alive.
  process.exit(0);
}

main().catch((err) => {
  console.error('[e2e] FAIL', err);
  stopServer();
  process.exit(1);
});

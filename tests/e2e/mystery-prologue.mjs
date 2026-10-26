// Browser check for Thing's prologue (story script v3.2) between the duo cards and the tutorial:
//  A. complete: Next through all six panels (screenshots, exact Stay Silent warning, neutral suspects, duo on panel 6)
//     → mission card → Replay (R) → Next ×6 → "Begin Investigation" → tutorial with the run in status 'tutorial' →
//     Enter skips the tutorial → playing.
//  B. autoplay: no input for ~31 s walks every panel by itself and stops on the mission card; Enter begins.
//  C. skip: Esc on panel 1 → tutorial; the Skip button does the same; prologue=0 (reveal + story) and tutorial=0 bypass it.
//  D. layout at 1366×768 and 1920×1080 (nothing outside the viewport) and reduced motion.
// Usage: E2E_URL=http://localhost:5231 node tests/e2e/mystery-prologue.mjs   (PARTS=ABCD default)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_URL ?? 'http://localhost:5231';
const PARTS = process.env.PARTS ?? 'ABCD';
const OUT = process.env.E2E_OUT ?? 'output/prologue';
const STAY_SILENT = 'Stay Silent: Move slowly and avoid making noise — Hydes are sensitive to sound.';
const PANELS = ['island', 'death', 'egg', 'suspects', 'hyde', 'assignment'];
mkdirSync(OUT, { recursive: true });
const errors = [];
const assert = (c, m) => {
  if (!c) throw new Error(`Assertion failed: ${m}`);
};
const state = async (page) => JSON.parse(await page.evaluate(() => window.render_game_to_text?.() ?? 'null'));
const panel = (page) => page.getAttribute('[data-testid="screen-prologue"]', 'data-panel');

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  if (PARTS.includes('A')) await partA();
  if (PARTS.includes('B')) await partB();
  if (PARTS.includes('C')) await partC();
  if (PARTS.includes('D')) await partD();
} finally {
  await browser.close();
}
const relevant = errors.filter((e) => !/favicon|requestFullscreen|Permissions check failed|keyboard|pointer ?lock/i.test(e));
if (relevant.length) {
  console.log('console errors:', relevant);
  process.exitCode = 1;
}
console.log(process.exitCode ? 'FAILED' : 'prologue e2e: all parts passed');

async function freshPage(viewport = { width: 1366, height: 768 }, query = '') {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  // Galarian Corsola has no community 3D model upstream (DECISIONS: it falls back to artwork); that one 404 is known.
  page.on('response', (r) => r.status() >= 400 && !/galar\/222\.glb$/.test(r.url()) && errors.push(`${r.status()} ${r.url()}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/${query}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  return page;
}

/** Home → nickname → cards → select the first duo; resolves once the prologue (or the next screen) is up. */
async function toPrologue(page, next = '[data-testid="screen-prologue"]') {
  await page.waitForSelector('[data-testid="screen-splash"]');
  await page.click('[data-testid="btn-start"]');
  await page.waitForSelector('[data-testid="screen-nickname"]');
  await page.fill('[data-testid="input-nickname"]', 'Prologue Tester');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="screen-cards"]');
  await page.waitForTimeout(700);
  await page.click('[data-testid="btn-select-duo-0"]');
  if (next === '[data-testid="screen-prologue"]') {
    // The assigned case file is revealed first (skip its animation, then begin).
    await page.waitForSelector('[data-testid="screen-case-reveal"]', { timeout: 30000 });
    await page.waitForTimeout(600);
    await page.click('[data-testid="btn-case-skip"]', { timeout: 2000 }).catch(() => undefined);
    await page.click('[data-testid="btn-case-begin"]');
  }
  await page.waitForSelector(next, { timeout: 30000 });
}

async function expectTutorial(page, label) {
  await page.waitForSelector('[data-testid="mystery-tutorial"]', { timeout: 60000 });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).play?.phase === 'ready', null, { timeout: 60000 });
  const st = await state(page);
  assert(st.screen === 'tutorial' && st.run?.status === 'tutorial', `${label}: tutorial after prologue (got ${st.screen}/${st.run?.status})`);
  assert(!(await page.$('[data-testid="screen-prologue"]')), `${label}: prologue unmounted`);
  return st;
}

async function partA() {
  const page = await freshPage();
  await toPrologue(page);
  let st = await state(page);
  assert(st.screen === 'prologue' && st.session.selected, 'prologue after duo select, duo locked in');
  assert((await page.textContent('.prologue__who')).includes('Thing’s message (translated)'), 'translated-message label');
  const art = await page.getAttribute('.prologue__portrait .thing-portrait', 'data-art');
  console.log('thing portrait:', art);
  await page.waitForTimeout(1600); // let the title + words reveal
  for (let i = 0; i < PANELS.length; i++) {
    assert((await panel(page)) === PANELS[i], `panel ${i + 1} is ${PANELS[i]} (got ${await panel(page)})`);
    const title = await page.textContent('[data-testid="prologue-title"]');
    const text = await page.textContent('[data-testid="prologue-text"]');
    console.log(`panel ${i + 1} · ${title} · ${text.slice(0, 60)}…`);
    if (PANELS[i] === 'hyde') assert((await page.textContent('[data-testid="prologue-warning"]')) === STAY_SILENT, 'exact Stay Silent warning');
    if (PANELS[i] === 'suspects') {
      const names = await page.$$eval('.suspect-card__name', (els) => els.map((e) => e.textContent));
      const classes = await page.$$eval('.suspect-card', (els) => [...new Set(els.map((e) => e.className))]);
      assert(names.join('|') === 'Marilyn Thornhill|Isaac Night|Barry Dort' && classes.length === 1, `three equally framed suspects: ${names} ${classes}`);
    }
    if (PANELS[i] === 'assignment') assert((await page.$$('[data-testid="prologue-duo"] img')).length === 2, 'chosen duo shown on panel 6');
    await page.screenshot({ path: `${OUT}/A${i + 1}-${PANELS[i]}.png` });
    if (i === 0) {
      // Next button is focused on mount; Enter = Next. Manual navigation turns auto-advance off.
      await page.keyboard.press('Enter');
    } else await page.click('[data-testid="btn-prologue-next"]');
    await page.waitForTimeout(i === PANELS.length - 1 ? 2200 : 1700);
    if (i === 0) assert((await page.getAttribute('[data-testid="screen-prologue"]', 'data-autoplay')) === 'false', 'manual Next pauses autoplay');
  }
  assert(await page.isVisible('[data-testid="prologue-mission"]'), 'mission card');
  const mission = await page.textContent('#prologue-mission-title');
  assert(mission.replace(/\s+/g, ' ').includes('Investigate the Murder.Secure the Egg.Escape Alive.') || mission.includes('Investigate the Murder.'), `mission text: ${mission}`);
  await page.screenshot({ path: `${OUT}/A7-mission.png` });
  // Paused panels stay put
  await page.keyboard.press('r');
  await page.waitForTimeout(300);
  assert((await panel(page)) === 'island', 'R replays from panel 1');
  assert((await page.getAttribute('[data-testid="screen-prologue"]', 'data-autoplay')) === 'true', 'replay restarts autoplay');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  assert((await panel(page)) === 'death', 'arrow keys navigate');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  assert(await page.isVisible('[data-testid="prologue-mission"]'), 'back on the mission card');
  await page.click('[data-testid="btn-begin-investigation"]');
  st = await expectTutorial(page, 'A');
  await page.screenshot({ path: `${OUT}/A8-tutorial.png` });
  await page.waitForTimeout(700);
  await page.keyboard.press('Enter'); // skip tutorial
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).run?.status === 'playing', null, { timeout: 5000 });
  console.log('A ✓ complete → tutorial → playing');
  await page.context().close();
}

async function partB() {
  const page = await freshPage();
  await toPrologue(page);
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 34000) {
    seen.add(await panel(page));
    if (seen.has('mission')) break;
    await page.waitForTimeout(400);
  }
  const s = (Date.now() - t0) / 1000;
  console.log(`autoplay walked: ${[...seen].join(' → ')} in ${s.toFixed(1)} s`);
  assert([...PANELS, 'mission'].every((p) => seen.has(p)), 'autoplay visits every panel and reaches the mission card');
  assert(s > 25 && s < 34, `≈30 s of panels (${s.toFixed(1)} s)`);
  await page.waitForTimeout(3000);
  assert((await panel(page)) === 'mission', 'mission card waits for the visitor');
  await page.keyboard.press('Enter');
  await expectTutorial(page, 'B');
  console.log('B ✓ autoplay → mission → Enter → tutorial');
  await page.context().close();
}

async function partC() {
  let page = await freshPage();
  await toPrologue(page);
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await expectTutorial(page, 'C/Esc');
  await page.context().close();

  page = await freshPage();
  await toPrologue(page);
  await page.click('[data-testid="btn-prologue-skip"]');
  await expectTutorial(page, 'C/button');
  await page.context().close();

  page = await freshPage(undefined, '?mode=mystery&prologue=0');
  await toPrologue(page, '[data-testid="mystery-tutorial"]');
  assert((await state(page)).screen === 'tutorial', 'prologue=0 → tutorial');
  await page.context().close();

  page = await freshPage(undefined, '?mode=mystery&tutorial=0');
  await toPrologue(page, '[data-testid="screen-play"]');
  assert((await state(page)).screen === 'play', 'tutorial=0 → play');
  await page.context().close();
  console.log('C ✓ Esc / Skip button / prologue=0 / tutorial=0');
}

async function partD() {
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 820, height: 900 }]) {
    const page = await freshPage(viewport);
    await toPrologue(page);
    for (const p of PANELS) {
      await page.waitForTimeout(1500);
      const bad = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.prologue__bar *, .prologue__top *, .prologue__warning, .suspect-card, .pscene__duo')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5 || r.left < -0.5 || r.top < -0.5) out.push(el.className || el.tagName);
        }
        // the warning / suspect cards must not sit under the dialogue bar
        const bar = document.querySelector('.prologue__bar')?.getBoundingClientRect();
        for (const el of document.querySelectorAll('.prologue__warning, .suspect-card')) {
          if (bar && el.getBoundingClientRect().bottom > bar.top + 40) out.push(`${el.className} under bar`);
        }
        return out;
      });
      assert(bad.length === 0, `${viewport.width}×${viewport.height} ${p}: ${bad.join(', ')}`);
      if (viewport.width !== 1366) await page.screenshot({ path: `${OUT}/D-${viewport.width}-${p}.png` });
      await page.click('[data-testid="btn-prologue-next"]');
    }
    await page.waitForTimeout(1500);
    if (viewport.width !== 1366) await page.screenshot({ path: `${OUT}/D-${viewport.width}-mission.png` });
    await page.context().close();
  }
  // reduced motion: words visible at once
  const page = await freshPage();
  await page.evaluate(() => localStorage.setItem('raven-regatta:settings:v1', JSON.stringify({ reducedMotion: true, motionPref: 'on' })));
  await page.reload();
  await toPrologue(page);
  await page.waitForTimeout(150);
  const op = await page.$eval('.prologue__text span:last-child', (e) => getComputedStyle(e).opacity);
  assert(op === '1', `reduced motion shows the caption at once (opacity ${op})`);
  await page.screenshot({ path: `${OUT}/D-reduced-motion.png` });
  await page.context().close();
  console.log('D ✓ layout at 1366/1920/820 and reduced motion');
}

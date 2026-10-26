// Browser check for the three-case feature (docs/MYSTERY_CASES.md):
//  C. for each case via /?mode=mystery&case=<id>: Home → nickname → duo cards → CASE-FILE REVEAL (data-case, phases in
//     order, ≈3–5 s, assigned file = the case, no suspect names) → Begin → Thing's prologue → Skip → tutorial → playing
//     → test autopilot (stealthy) with advanceTime until the accusation → evidence board (case title, statements,
//     notes, no "points to / explains", focus trap, Esc inert) → suspect → cite evidence (≥ 1 required) → confirm →
//     results (verdict copy, cited evidence in the result, "What really happened" once the answer key loads).
//     The murderer is random per session; the local-demo fixture `&culprit=` forces it. Default: archive / barry accuses
//     the culprit with exactly the three clues (case_solved), crypt / thornhill the culprit with weak evidence (honest
//     "Right suspect" copy), signal / galpin an innocent (wrong suspect). MURDERERS=all plays all 9 case × murderer
//     scenarios (plans rotate). A run the bot loses (DNF) is retried.
//  R. reveal controls: Esc skips to the final state, a second Esc continues; reduced motion shows the final state at
//     once; layout at 1366×768, 1920×1080 and 360×740 (nothing off-screen horizontally, Begin reachable).
// Usage: E2E_URL=http://localhost:5231 node tests/e2e/mystery-cases.mjs   (PARTS=CR default; CASES=poisoned_archive,…)
// AUTOPILOT_ARG=object passes { profile: 'stealthy' } instead of 'stealthy' to window.mysteryAutopilot.
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.E2E_URL ?? 'http://localhost:5231';
const PARTS = process.env.PARTS ?? 'CR';
const OUT = process.env.E2E_OUT ?? 'output/cases';
const ONLY = process.env.CASES ? process.env.CASES.split(',') : null;
const AUTOPILOT_OBJECT = process.env.AUTOPILOT_ARG === 'object';
const MAX_ATTEMPTS = Number(process.env.ATTEMPTS ?? 3);
mkdirSync(OUT, { recursive: true });

// Test-side knowledge only: the case files and the murderer this test FORCES (local demo `&culprit=` fixture).
const CASE_FILES = [
  {
    id: 'poisoned_archive', number: '01', title: 'The Poisoned Archive',
    clues: ['falsified_transfer', 'botanical_residue', 'access_ledger'], notes: ['note_drain_mud', 'note_keys_jangling'],
  },
  {
    id: 'crypt_last_witness', number: '02', title: 'The Crypt’s Last Witness',
    clues: ['sabotaged_gate', 'tunnel_access_record', 'equipment_match'], notes: ['note_archive_boxes', 'note_bell_rope'],
  },
  {
    id: 'midnight_signal', number: '03', title: 'The Midnight Signal',
    clues: ['falsified_patrol_log', 'alarm_override', 'watchtower_signal'], notes: ['note_greenhouse_light', 'note_archive_door'],
  },
];
const SUSPECTS = ['thornhill', 'galpin', 'barry'];
const PLANS = ['solve', 'weak_evidence', 'wrong_suspect'];
const CASES = process.env.MURDERERS === 'all'
  ? CASE_FILES.flatMap((f, i) => SUSPECTS.map((culprit, j) => ({ ...f, culprit, plan: PLANS[(i + j) % 3] })))
  : [
    { ...CASE_FILES[0], culprit: 'barry', plan: 'solve' },
    { ...CASE_FILES[1], culprit: 'thornhill', plan: 'weak_evidence' },
    { ...CASE_FILES[2], culprit: 'galpin', plan: 'wrong_suspect' },
  ];
const NAMES = { thornhill: 'Marilyn Thornhill', galpin: 'Françoise Galpin', barry: 'Barry Dort' };
const SUSPECT_WORDS = ['Marilyn', 'Thornhill', 'Françoise', 'Galpin', 'Barry', 'Dort'];

/** The 3D "how it happened" cutscene between the case reveal and the prologue: hooded killer, no suspect named. */
async function skipMurder(page, caseId = null) {
  await page.waitForSelector('[data-testid="screen-murder"]', { timeout: 30000 });
  if (caseId) assert((await page.getAttribute('[data-testid="screen-murder"]', 'data-case')) === caseId, `murder cutscene shows case ${caseId}`);
  const text = await page.textContent('[data-testid="screen-murder"]');
  for (const w of ['Thornhill', 'Marilyn', 'Galpin', 'Françoise', 'Barry', 'Dort']) assert(!text.includes(w), `cutscene names no suspect (${w})`);
  await page.click('[data-testid="btn-murder-skip"]');
}

const errors = [];
const assert = (c, m) => {
  if (!c) throw new Error(`Assertion failed: ${m}`);
};
const state = async (page) => JSON.parse(await page.evaluate(() => window.render_game_to_text?.() ?? 'null'));
const tid = (id) => `[data-testid="${id}"]`;

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
try {
  if (PARTS.includes('C')) for (const c of CASES) if (!ONLY || ONLY.includes(c.id)) await caseFlow(c);
  if (PARTS.includes('R')) await partR();
} finally {
  await browser.close();
}
const relevant = errors.filter((e) => !/favicon|requestFullscreen|Permissions check failed|keyboard|pointer ?lock|AudioContext/i.test(e));
if (relevant.length) {
  console.log('console errors:', relevant);
  process.exitCode = 1;
}
console.log(process.exitCode ? 'FAILED' : 'cases e2e: all parts passed');

async function freshPage(viewport = { width: 1366, height: 768 }, query = '', settings = null) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  // Galarian Corsola has no community 3D model upstream (DECISIONS: it falls back to artwork); that one 404 is known.
  page.on('response', (r) => r.status() >= 400 && !/galar\/222\.glb$/.test(r.url()) && errors.push(`${r.status()} ${r.url()}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/${query}`);
  await page.evaluate((s) => {
    localStorage.clear();
    if (s) localStorage.setItem('raven-regatta:settings:v1', JSON.stringify(s));
  }, settings);
  await page.reload();
  return page;
}

/** Home → nickname → cards → first duo; resolves once the case-file reveal is mounted. */
async function toReveal(page, nickname = 'Case Tester') {
  await page.waitForSelector(tid('screen-splash'));
  await page.click(tid('btn-start'));
  await page.waitForSelector(tid('screen-nickname'));
  await page.fill(tid('input-nickname'), nickname);
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForSelector(tid('screen-cards'));
  await page.waitForTimeout(700);
  await page.click(tid('btn-select-duo-0'));
  await page.waitForSelector(tid('screen-case-reveal'), { timeout: 30000 });
}

function phaseOf(page) {
  return page.getAttribute(tid('screen-case-reveal'), 'data-phase');
}

/** Watches the reveal's phases until ready; returns the order seen and the elapsed seconds. */
async function watchReveal(page, label) {
  const seen = [];
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 9000) {
    const p = await phaseOf(page);
    if (p && seen[seen.length - 1] !== p) seen.push(p);
    if (p === 'assign' && !shot) {
      shot = true;
      await page.waitForTimeout(700); // stamp landed
      await page.screenshot({ path: `${OUT}/${label}-assign.png` });
    }
    if (p === 'ready') break;
    await page.waitForTimeout(60);
  }
  const s = (Date.now() - t0) / 1000;
  return { seen, s };
}

async function revealHasNoSuspects(page, label) {
  const text = await page.textContent(tid('screen-case-reveal'));
  for (const w of SUSPECT_WORDS) assert(!text.includes(w), `${label}: reveal names no suspect (found "${w}")`);
  assert(!/culprit|guilty|murderer/i.test(text), `${label}: reveal hints at no answer`);
}

async function expectTutorial(page, label) {
  await page.waitForSelector(tid('mystery-tutorial'), { timeout: 60000 });
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).play?.phase === 'ready', null, { timeout: 60000 });
  const st = await state(page);
  assert(st.run?.status === 'tutorial', `${label}: run in tutorial (got ${st.screen}/${st.run?.status})`);
}

/** Runs the test autopilot under advanceTime until the accusation (or the end of the run). */
async function autopilotToAccusation(page, label) {
  const ok = await page.evaluate((asObject) => window.mysteryAutopilot?.(asObject ? { profile: 'stealthy' } : 'stealthy'), AUTOPILOT_OBJECT);
  assert(ok, `${label}: autopilot engaged`);
  for (let i = 0; i < 300; i++) {
    await page.evaluate(() => window.advanceTime(4000));
    const st = await state(page);
    const status = st.run?.status;
    if (status === 'accusing' || st.screen === 'accusing') return { st, outcome: 'accusing' };
    if (status === 'dnf' || status === 'finished' || st.screen === 'results') return { st, outcome: status ?? st.screen };
  }
  throw new Error(`${label}: autopilot did not reach the accusation`);
}

async function caseFlow(c) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const label = `${c.number}-${c.culprit}${attempt > 1 ? `#${attempt}` : ''}`;
    const page = await freshPage(undefined, `?mode=mystery&case=${c.id}&culprit=${c.culprit}`);
    try {
      const done = await caseAttempt(page, c, label);
      if (done) return;
      console.log(`${label}: the bot lost the run (DNF) — retrying`);
    } finally {
      await page.context().close();
    }
  }
  throw new Error(`case ${c.id}: no attempt reached the accusation`);
}

async function caseAttempt(page, c, label) {
  // ---- reveal
  await toReveal(page);
  assert((await page.getAttribute(tid('screen-case-reveal'), 'data-case')) === c.id, `${label}: reveal shows the forced case ${c.id}`);
  const { seen, s } = await watchReveal(page, label);
  console.log(`${label} reveal: ${seen.join(' → ')} in ${s.toFixed(1)} s`);
  assert(seen.join(',') === 'deal,spread,shuffle,assign,ready', `${label}: phases in order (${seen})`);
  assert(s > 3 && s < 5.8, `${label}: reveal ≈3–5 s (${s.toFixed(1)} s)`);
  assert((await page.getAttribute(tid('case-file-assigned'), 'data-number')) === c.number, `${label}: assigned file is case ${c.number}`);
  const brief = await page.textContent(tid('case-brief'));
  assert(brief.includes(`Case ${c.number}`) && brief.includes(c.title), `${label}: brief shows number + title (${brief.slice(0, 80)})`);
  await revealHasNoSuspects(page, label);
  await page.screenshot({ path: `${OUT}/${label}-reveal-ready.png` });
  assert((await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) === 'btn-case-begin', `${label}: Begin focused on ready`);
  await page.click(tid('btn-case-begin'));

  // ---- murder cutscene → prologue → tutorial → playing
  await skipMurder(page, c.id);
  await page.waitForSelector(tid('screen-prologue'), { timeout: 30000 });
  await page.click(tid('btn-prologue-skip'));
  await expectTutorial(page, label);
  await page.waitForTimeout(700);
  await page.keyboard.press('Enter'); // skip the tutorial
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).run?.status === 'playing', null, { timeout: 8000 });

  // ---- autopilot to the accusation
  const { st, outcome } = await autopilotToAccusation(page, label);
  if (outcome !== 'accusing') return false;
  const found = st.run?.cluesFound ?? [];
  console.log(`${label}: accusation reached at t=${st.run?.t}s with clues [${found.join(', ')}]`);
  await page.waitForSelector(`${tid('evidence-board')}[data-mode="accuse"]`, { timeout: 20000 });
  await page.waitForTimeout(400);

  // ---- board content (public data only)
  const boardText = await page.textContent(tid('evidence-board'));
  assert(boardText.includes(`Case ${c.number}`) && boardText.includes(c.title), `${label}: board shows the case`);
  assert(boardText.includes('Case-file notes'), `${label}: board shows the case-file notes`);
  assert(!/Points to|Explains|Linked by|Explained by/.test(boardText), `${label}: no guilt links on the board`);
  for (const id of c.clues) {
    const f = await page.getAttribute(tid(`clue-${id}`), 'data-found');
    assert(f === String(found.includes(id)), `${label}: clue ${id} found=${found.includes(id)} (board says ${f})`);
  }
  const shapes = await page.$$eval('.board__suspects > li', (els) => [...new Set(els.map((e) => e.className))]);
  assert(shapes.length === 1, `${label}: suspects styled identically (${shapes})`);
  await page.screenshot({ path: `${OUT}/${label}-board.png` });

  // ---- focus trap + Esc inert
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  assert(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="evidence-board"]')), `${label}: Tab stays inside the board`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  assert(await page.isVisible(tid('accuse-panel')), `${label}: Esc does not close the accusation`);

  // ---- plan
  const allFound = c.clues.every((id) => found.includes(id));
  let plan = c.plan;
  if (plan === 'solve' && !allFound) plan = 'weak_evidence';
  // Ruling R3: with fewer than all clues the panel is gated (data-step="gated") — only "Leave the case unsolved".
  const gated = (await page.getAttribute(tid('accuse-panel'), 'data-step')) === 'gated';
  assert(gated === !allFound, `${label}: accusation gated exactly when a clue is missing (gated=${gated}, found ${found.length})`);
  if (gated) {
    assert(!(await page.$('[data-testid^="radio-"]')), `${label}: no suspect can be named with ${found.length} clues`);
    assert((await page.textContent(tid('accuse-panel'))).includes(`Find all ${c.clues.length} clues to accuse.`), `${label}: gate explains why`);
    await page.click(tid('btn-leave-unsolved'));
    await page.waitForSelector(tid('accuse-confirm'));
    await page.waitForTimeout(600);
    await page.click(tid('btn-accuse-confirm'));
    await page.waitForSelector(tid('screen-results'), { timeout: 30000 });
    const v = await page.getAttribute(tid('screen-results'), 'data-verdict');
    assert(v === 'not_accused' || v === 'egg_secured_mystery_unsolved', `${label}: gated run ends unsolved (got ${v})`);
    const sub = await page.textContent(tid('verdict-sub'));
    assert(sub.includes('left the case unsolved') && sub.includes(`of ${c.clues.length} clues`), `${label}: unsolved copy (${sub})`);
    assert(!sub.includes(NAMES[c.culprit]), `${label}: unsolved copy never names the culprit`);
    const res = (await state(page)).result;
    assert(res?.accused === null && (res?.evidence ?? []).length === 0, `${label}: nobody accused, nothing cited`);
    await page.screenshot({ path: `${OUT}/${label}-results.png` });
    console.log(`${c.number} ✓ ${c.id}: reveal → prologue → tutorial → accusation gated (${found.length}/${c.clues.length} clues) → ${v}`);
    return true;
  }
  const suspect = plan === 'wrong_suspect' ? Object.keys(NAMES).find((k) => k !== c.culprit) : c.culprit;
  const cite = plan === 'solve'
    ? [...c.clues]
    : plan === 'weak_evidence'
      ? [...found.slice(0, 1), c.notes[0]]
      : [...found, c.notes[1]];

  await page.click(tid(`radio-${suspect}`));
  await page.click(tid('btn-accuse'));
  await page.waitForSelector(tid('btn-accuse-next'));
  const q = await page.textContent(tid('accuse-panel'));
  assert(q.includes(`Which evidence supports accusing ${NAMES[suspect]}?`), `${label}: step 2 asks for evidence against ${NAMES[suspect]}`);
  const offered = await page.$$eval('[data-testid^="evidence-option-"]', (els) => els.map((e) => e.getAttribute('data-testid').slice('evidence-option-'.length)));
  assert(offered.join(',') === [...c.clues.filter((id) => found.includes(id)), ...c.notes].join(','), `${label}: citable = found clues + notes (${offered})`);
  assert((await page.getAttribute(tid('btn-accuse-next'), 'aria-disabled')) === 'true', `${label}: Continue needs at least one item`);
  await page.click(tid('btn-accuse-next'), { force: true }); // aria-disabled: activation only announces the reason
  assert(!(await page.$(tid('accuse-confirm'))), `${label}: nothing cited → no confirm`);
  for (const id of cite) await page.check(tid(`evidence-option-${id}`));
  await page.screenshot({ path: `${OUT}/${label}-evidence.png` });
  await page.click(tid('btn-accuse-next'));
  await page.waitForSelector(tid('accuse-confirm'));
  assert((await page.textContent(tid('accuse-confirm'))).includes('You can accuse only once.'), `${label}: one-shot warning`);
  await page.waitForTimeout(600);
  await page.click(tid('btn-accuse-confirm'));

  // ---- results
  await page.waitForSelector(tid('screen-results'), { timeout: 30000 });
  const verdict = await page.getAttribute(tid('screen-results'), 'data-verdict');
  const expected = plan === 'solve' ? 'case_solved' : 'egg_secured_mystery_unsolved';
  assert(verdict === expected, `${label}: verdict ${expected} (got ${verdict})`);
  assert((await page.getAttribute(tid('screen-results'), 'data-case')) === c.id, `${label}: results for the case`);
  const sub = await page.textContent(tid('verdict-sub'));
  if (plan === 'solve') assert(sub.includes(NAMES[c.culprit]) && sub.includes('Every clue held.'), `${label}: solved copy (${sub})`);
  if (plan === 'weak_evidence') assert(sub.includes('Right suspect'), `${label}: honest right-suspect copy (${sub})`);
  if (plan === 'wrong_suspect') assert(sub.includes(`You accused ${NAMES[suspect]}`) && !sub.includes(NAMES[c.culprit]), `${label}: wrong-suspect copy (${sub})`);
  assert(sub.includes(`of ${c.clues.length} clues`) || plan === 'solve', `${label}: clue count uses the case (${sub})`);
  const res = (await state(page)).result;
  assert(res?.caseId === c.id, `${label}: result.caseId (${res?.caseId})`);
  assert(JSON.stringify([...(res?.evidence ?? [])].sort()) === JSON.stringify([...cite].sort()), `${label}: cited evidence recorded (${res?.evidence})`);
  assert(res?.deductionCorrect === (plan === 'solve'), `${label}: deductionCorrect ${res?.deductionCorrect}`);
  await page.waitForSelector(`${tid('case-truth')}[data-state="open"]`, { timeout: 15000 });
  const truth = await page.textContent(tid('case-truth'));
  assert(truth.includes(NAMES[c.culprit]), `${label}: "What really happened" names the culprit`);
  for (const other of Object.keys(NAMES).filter((k) => k !== c.culprit)) assert(await page.isVisible(tid(`innocent-${other}`)), `${label}: ${other} explained`);
  const off = await offscreen(page, '.mys-results *');
  assert(off.length === 0, `${label}: results fit 1366×768 (${off.slice(0, 5).join(', ')})`);
  const overlap = await page.evaluate(() => {
    const foot = document.querySelector('.mys-results__foot')?.getBoundingClientRect();
    const above = [...document.querySelectorAll('[data-testid="btn-play-again"], .mys-results__left > *, .layer-panel')].map((e) => e.getBoundingClientRect().bottom);
    return foot ? Math.max(...above) - foot.top : 0;
  });
  assert(overlap <= 1, `${label}: "What really happened" does not cover the results above it (${overlap.toFixed(0)} px)`);
  await page.screenshot({ path: `${OUT}/${label}-results.png` });
  console.log(`${c.number} ✓ ${c.id}: reveal → prologue → tutorial → accusation (${plan}) → ${verdict}`);
  return true;
}

/** Elements (with a box) outside the viewport. */
function offscreen(page, selector, { horizontalOnly = false } = {}) {
  return page.evaluate(({ selector, horizontalOnly }) => {
    const out = [];
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      const h = r.right > innerWidth + 0.5 || r.left < -0.5;
      const v = r.bottom > innerHeight + 0.5 || r.top < -0.5;
      if (h || (!horizontalOnly && v)) out.push(`${el.className || el.tagName}`);
    }
    return out;
  }, { selector, horizontalOnly });
}

async function partR() {
  // Skip: Esc mid-animation → final state at once; Enter is guarded briefly; Esc again → prologue.
  let page = await freshPage(undefined, '?mode=mystery&case=midnight_signal');
  await toReveal(page);
  await page.waitForTimeout(900);
  assert((await phaseOf(page)) !== 'ready', 'R: still animating before skip');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  assert((await phaseOf(page)) === 'ready', 'R: Esc jumps to the final state');
  assert(!(await page.$(tid('btn-case-skip'))), 'R: Skip button gone on the final state');
  assert(await page.isVisible(tid('btn-case-begin')), 'R: Begin shown after skip');
  await page.keyboard.press('Escape');
  await skipMurder(page);
  await page.waitForSelector(tid('screen-prologue'), { timeout: 15000 });
  await page.context().close();

  // Skip button, then Enter begins.
  page = await freshPage(undefined, '?mode=mystery&case=poisoned_archive');
  await toReveal(page);
  await page.click(tid('btn-case-skip'));
  assert((await phaseOf(page)) === 'ready', 'R: Skip button jumps to the final state');
  await page.waitForTimeout(650);
  await page.keyboard.press('Enter');
  await skipMurder(page);
  await page.waitForSelector(tid('screen-prologue'), { timeout: 15000 });
  await page.context().close();

  // Reduced motion: final state at once, no movement.
  page = await freshPage(undefined, '?mode=mystery&case=crypt_last_witness', { reducedMotion: true, motionPref: 'on' });
  await toReveal(page);
  assert((await phaseOf(page)) === 'ready', 'R: reduced motion starts on the final state');
  const moving = await page.$$eval('.cfile, .cfile__body', (els) => els.filter((e) => e.getAnimations().some((a) => a.playState === 'running')).length);
  assert(moving === 0, `R: reduced motion — no running animations on the files (${moving})`);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/R-reduced-motion.png` });
  await page.context().close();

  // Layout at three sizes, in the final state.
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 360, height: 740 }]) {
    page = await freshPage(viewport, '?mode=mystery&case=crypt_last_witness');
    await toReveal(page);
    await page.waitForSelector(`${tid('screen-case-reveal')}[data-phase="ready"]`, { timeout: 9000 });
    await page.waitForTimeout(900);
    const narrow = viewport.width < 700;
    const off = await offscreen(page, '.case-reveal__top *, .cfile, .case-reveal__brief *, .case-reveal__thing', { horizontalOnly: narrow });
    assert(off.length === 0, `R ${viewport.width}×${viewport.height}: off-screen ${off.join(', ')}`);
    const overflowX = await page.$eval(tid('screen-case-reveal'), (e) => e.scrollWidth > e.clientWidth + 1);
    assert(!overflowX, `R ${viewport.width}: no horizontal scroll`);
    await page.locator(tid('btn-case-begin')).scrollIntoViewIfNeeded();
    assert(await page.isVisible(tid('btn-case-begin')), `R ${viewport.width}: Begin reachable`);
    await page.screenshot({ path: `${OUT}/R-${viewport.width}x${viewport.height}.png`, fullPage: narrow });
    await page.context().close();
  }
  console.log('R ✓ Esc skip / Skip button / reduced motion / layout 1366, 1920, 360');
}

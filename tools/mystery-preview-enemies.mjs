// Enemy staging shots (Hyde + Crackstone) through the preview harness. Usage:
//   node tools/mystery-preview-enemies.mjs <set> [outDir] [baseUrl] [case]
//   sets: hyde-close | hyde-modes | crack-close | crack-modes | telegraph | cases | all
// Needs the dev server (npx vite --port 5173) and PLAYWRIGHT_BROWSERS_PATH=D:\PokemonDay-cache\ms-playwright.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
const SET = process.argv[2] ?? 'all';
const OUT = process.argv[3] ?? 'output/enemies';
const BASE = process.argv[4] ?? 'http://localhost:5173';
const CASE = process.argv[5] ?? 'crypt_last_witness';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const errors = [];

async function open(caseId, extra = '', size = [1366, 768]) {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&case=${caseId}${extra}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mReady, null, { timeout: 90000 });
  return page;
}
const run = (page, js) => page.evaluate(`(async () => { const m = window.__m; ${js} })()`);
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); };

// Hyde staged at (hx,hz) facing -Z; camera orbit helper (angle 0 = looking at his front from -Z, pi/2 = from his left side).
const stageHyde = (mode, extra = {}) => `
  m.setHydeEmerged(true); m.setEffects({});
  m.place(0, 56, 0, 'idle');
  m.setHyde({ x: 0, z: 44, yaw: ${extra.yaw ?? 0}, mode: ${JSON.stringify(mode)}, speed: ${extra.speed ?? 0}, grabbing: ${!!extra.grab}, suspicion: 0.5, lastKnown: ${extra.look ? '{x:4,z:40}' : 'null'} });
  m.setFlags({ hydeWalk: false });
`;
const orbit = (ang, dist, h = 1.6, fov = 45, ty = 1.3) => `m.cam({ pos: [Math.sin(${ang}) * ${dist}, ${h}, 44 - Math.cos(${ang}) * ${dist}], look: [0, ${ty}, 44], fov: ${fov}, fog: 0.004 });`;

async function hydeClose() {
  const page = await open(CASE);
  await run(page, stageHyde('PATROL', { speed: 0 }) + `m.settle(1.5);`);
  const views = [['front', 0.0, 8.5], ['side-l', Math.PI / 2, 9], ['34', 0.8, 8.5], ['rear', Math.PI * 0.85, 9], ['side-r', -Math.PI / 2, 9], ['top34', 0.6, 7.5, 6.0]];
  for (const [n, a, d, hgt] of views) {
    await run(page, orbit(a, d, hgt ?? 1.8) + `m.render(2, 1/30);`);
    await shot(page, `hyde-close-${n}`);
  }
  await page.close();
}

async function hydeModes() {
  const page = await open(CASE);
  const gameCam = (dist = 5.0) => `m.cam(null);`;
  void gameCam;
  // gameplay camera: player at (0,56) looking -Z; Hyde ahead
  const cases = [
    ['crawl', 'PATROL', { speed: 2.2 }, 7.5, 2.6],
    ['gallop', 'CHASE', { speed: 5.2 }, 7.5, 2.4],
    ['listening', 'INVESTIGATE_SOUND', { speed: 0.0, look: true }, 8, 2.0],
    ['search', 'SEARCH', { speed: 1.2, look: true }, 8, 2.0],
    ['lunge', 'CHASE', { speed: 0.0, grab: true }, 6.5, 1.0],
    ['cooldown', 'COOLDOWN', { speed: 0.8 }, 8, 2.0],
  ];
  for (const [name, mode, o, dist, secs] of cases) {
    await run(page, `m.cam(null);` + stageHyde(mode, { ...o, yaw: Math.PI }) + `m.setFlags({ hydeWalk: false }); m.place(0, 44 + ${dist}, 0, 'idle');
      m.setHyde({ x: 0, z: 44, yaw: Math.PI, speed: ${o.speed}, mode: ${JSON.stringify(mode)}, grabbing: ${!!o.grab} }); m.settle(0.6); m.advance(${secs}, 15);`);
    // follow: re-centre the hyde ahead of the player (the fake walks him away)
    await run(page, `const h = m.run.hyde; m.place(h.x, h.z + ${dist}, 0, 'idle'); m.setFlags({ hydeWalk: false }); m.render(6, 1/30);`);
    await shot(page, `hyde-${name}-game`);
    await run(page, `const h = m.run.hyde; m.cam({ pos: [h.x + 6.2, 2.0, h.z + 3.0], look: [h.x, 1.2, h.z], fov: 42, fog: 0.004 }); m.render(2, 1/30);`);
    await shot(page, `hyde-${name}-close`);
    await run(page, `m.cam(null);`);
  }
  await page.close();
}

// ---- Crackstone ------------------------------------------------------------------------------------------------------------
const stageCrack = (mode, o = {}) => `
  m.setHydeEmerged(false); m.setEffects({}); m.cam(null);
  m.place(0, 56, 0, 'idle');
  m.setCrack({ x: 0, z: 44, yaw: ${o.yaw ?? 0}, mode: ${JSON.stringify(mode)}, speed: ${o.speed ?? 0}, suspicion: 0.5, lastKnown: ${o.look ? '{x:4,z:40}' : 'null'}, scan: null, curse: null, stunnedUntil: 0 });
  m.setCrackFlags({ walk: false, script: 'off', visual: null, curseHit: true });
`;

async function crackClose() {
  const page = await open(CASE);
  await run(page, stageCrack('PATROL') + `m.settle(1.5);`);
  const views = [['front', 0.0, 6.2, 1.5], ['34', 0.7, 6.0, 1.7], ['side', Math.PI / 2, 6.2, 1.5], ['rear', Math.PI * 0.82, 6.5, 1.8], ['face', 0.25, 2.5, 1.9, 1.95]];
  for (const [n, a, d, h, ty] of views) {
    await run(page, `m.cam({ pos: [Math.sin(${a}) * ${d}, ${h}, 44 - Math.cos(${a}) * ${d}], look: [0, ${ty ?? 1.2}, 44], fov: ${n === 'face' ? 30 : 42}, fog: 0.004 }); m.render(2, 1/30);`);
    await shot(page, `crack-close-${n}`);
  }
  await page.close();
}

async function crackModes() {
  const page = await open(CASE);
  const cases = [
    ['patrol', 'PATROL', { speed: 1.5 }, 3.0, 8.0],
    ['pause', 'PATROL', { speed: 0 }, 1.0, 8.0],
    ['chase', 'CHASE', { speed: 3.8 }, 2.2, 7.5],
    ['investigate', 'INVESTIGATE', { speed: 2.4 }, 2.0, 8.0],
    ['search', 'SEARCH', { speed: 0, look: true }, 1.6, 8.0],
  ];
  for (const [name, mode, o, secs, dist] of cases) {
    await run(page, stageCrack(mode, { ...o, yaw: Math.PI }) + `m.setCrackFlags({ walk: false }); m.settle(0.5); m.advance(${secs}, 15);`);
    await run(page, `const c = m.run.crackstone; m.setCrackFlags({ walk: false }); m.place(c.x, c.z + ${dist}, 0, 'idle'); m.render(8, 1/30);`);
    await shot(page, `crack-${name}-game`);
    await run(page, `const c = m.run.crackstone; m.cam({ pos: [c.x + 4.2, 1.7, c.z - 2.4], look: [c.x, 1.2, c.z], fov: 42, fog: 0.004 }); m.render(2, 1/30);`);
    await shot(page, `crack-${name}-close`);
    await run(page, `m.cam(null);`);
  }
  // attack: curse wind-up, staff raised then thrust
  await run(page, stageCrack('ATTACK', { yaw: Math.PI }) + `m.place(0, 56, 0, 'idle'); m.settle(0.3); m.castCurse(0, 56, 3.2, 1.8); m.advance(1.0, 15);`);
  await shot(page, 'crack-attack-game');
  await run(page, `const c = m.run.crackstone; m.cam({ pos: [c.x + 4.6, 1.8, c.z + 2.6], look: [c.x, 1.4, c.z], fov: 44, fog: 0.004 }); m.render(2, 1/30);`);
  await shot(page, 'crack-attack-raised-close');
  await run(page, `m.advance(0.72, 15); m.render(1, 1/30);`);
  await shot(page, 'crack-attack-thrust-close');
  await run(page, `m.cam(null); m.advance(1.5, 15);`);
  // scan warning: arms spread, aura flare
  await run(page, stageCrack('PATROL', { yaw: Math.PI }) + `m.settle(0.4); m.crackScan(9, 2.2); m.advance(1.4, 15);`);
  await shot(page, 'crack-scan-game');
  await run(page, `const c = m.run.crackstone; m.cam({ pos: [c.x + 4.4, 1.8, c.z - 3.4], look: [c.x, 1.3, c.z], fov: 44, fog: 0.004 }); m.render(2, 1/30);`);
  await shot(page, 'crack-scan-close');
  await page.close();
}

async function telegraph() {
  const page = await open(CASE);
  // scan ring: early / mid / late in the warning, then the pulse; gameplay camera and an aerial view
  await run(page, stageCrack('PATROL') + `m.settle(0.4); m.crackScan(9, 2.4); m.render(1, 1/30);`);
  for (const [n, secs] of [['early', 0.6], ['mid', 0.9], ['late', 0.7]]) {
    await run(page, `m.advance(${secs}, 15);`);
    await shot(page, `scan-ring-${n}-game`);
    await run(page, `m.cam({ pos: [0, 21, 51], look: [0, 0, 44], fov: 55, fog: 0.002 }); m.render(2, 1/30);`);
    await shot(page, `scan-ring-${n}-aerial`);
    await run(page, `m.cam(null); m.render(1, 1/30);`);
  }
  await run(page, `m.advance(0.26, 30);`);
  await shot(page, 'scan-pulse-game');
  await run(page, `m.advance(2, 15);`);
  // reduced motion variant of the scan
  await run(page, `m.setReduced(true); m.crackScan(9, 2.4); m.advance(0.8, 15);`);
  await shot(page, 'scan-ring-reduced-game');
  await run(page, `m.setReduced(false); m.advance(2.5, 15);`);
  // curse circle on the player's feet: mid-fill, nearly full, hit burst, miss fade
  await run(page, stageCrack('ATTACK') + `m.settle(0.3); m.castCurse(0, 54, 3.2, 2.0); m.advance(0.45, 15);`);
  await shot(page, 'curse-circle-fill-early-game');
  await run(page, `m.advance(0.55, 15);`);
  await shot(page, 'curse-circle-fill-mid-game');
  await run(page, `m.cam({ pos: [0, 14, 60], look: [0, 0, 49], fov: 50, fog: 0.002 }); m.render(2, 1/30);`);
  await shot(page, 'curse-circle-fill-mid-aerial');
  await run(page, `m.cam(null); m.advance(0.62, 15);`);
  await shot(page, 'curse-circle-fill-late-game');
  await run(page, `m.advance(0.33, 30);`);
  await shot(page, 'curse-burst-hit-game');
  await run(page, `m.advance(1.5, 15);`);
  await run(page, `m.setCrackFlags({ curseHit: false }); m.castCurse(0, 54, 3.2, 1.2); m.advance(1.3, 30);`);
  await shot(page, 'curse-miss-fade-game');
  await run(page, `m.setReduced(true); m.setCrackFlags({ curseHit: true }); m.advance(1, 15); m.castCurse(0, 54, 3.2, 2.0); m.advance(1.2, 15);`);
  await shot(page, 'curse-circle-reduced-game');
  await page.close();
  // low graphics
  const low = await open(CASE, '&low=1');
  await run(low, stageCrack('PATROL') + `m.settle(0.4); m.crackScan(9, 2.4); m.advance(1.2, 15);`);
  await shot(low, 'scan-ring-low-game');
  await low.close();
}

async function cases() {
  for (const cs of ['poisoned_archive', 'crypt_last_witness', 'midnight_signal']) {
    const page = await open(cs);
    await run(page, `
      m.setHydeEmerged(true); m.setEffects({}); m.cam(null);
      m.place(0, 56, 0, 'idle');
      m.setHyde({ x: -6.5, z: 47, yaw: Math.PI - 0.5, mode: 'SEARCH', speed: 0, suspicion: 0.6, grabbing: false, lastKnown: { x: 0, z: 56 } });
      m.setCrack({ x: 3.6, z: 44, yaw: Math.PI + 0.3, mode: 'PATROL', speed: 0, suspicion: 0 });
      m.settle(1.2); m.render(4, 1/30);`);
    await shot(page, `case-${cs}-both`);
    await run(page, `m.setHyde({ x: -6.5, z: 47, yaw: Math.PI - 0.5, mode: 'CHASE', speed: 0 }); m.setCrack({ mode: 'CHASE' }); m.settle(0.6); m.crackScan(8, 2.0); m.advance(1.2, 15);`);
    await shot(page, `case-${cs}-chase-scan`);
    await page.close();
  }
}

// ---- side-by-side sheets: owner reference photos next to our shots -------------------------------------------------------------
async function sheet(name, pairs, cols) {
  const b64 = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  const cells = pairs.map(([ref, mine, cap]) => `<figure><div class="row"><img src="${b64(ref)}"><img src="${b64(mine)}"></div><figcaption>${cap}</figcaption></figure>`).join('');
  const page = await browser.newPage({ viewport: { width: 1800, height: 900 } });
  await page.setContent(`<style>body{margin:0;background:#111;color:#ddd;font:13px system-ui}main{display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px;padding:8px}figure{margin:0}.row{display:flex;gap:4px;align-items:stretch;background:#000}.row img{height:380px;width:auto;max-width:49.5%;object-fit:contain;flex:1}figcaption{padding:2px 4px}</style><main>${cells}</main>`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('sheet', name);
  await page.close();
}

async function hydeSheet() {
  const page = await open(CASE, '', [1000, 760]);
  await run(page, stageHyde('PATROL', { speed: 0 }) + `m.settle(1.5);`);
  const cams = [
    ['hyde-ref-1', 'front-left, low', `m.cam({ pos: [-4.2, 1.1, 44 - 5.6], look: [0, 1.25, 43.6], fov: 40, fog: 0.004 });`],
    ['hyde-ref-2', 'side 3/4', `m.cam({ pos: [6.2, 2.0, 44 - 3.2], look: [0, 1.25, 43.8], fov: 40, fog: 0.004 });`],
    ['hyde-ref-3', 'face close-up', `m.cam({ pos: [-1.2, 1.4, 44 - 3.4], look: [0, 1.55, 42.6], fov: 34, fog: 0.004 });`],
    ['hyde-ref-4', 'side, rear-left', `m.cam({ pos: [-6.2, 2.0, 44 - 2.0], look: [0, 1.25, 43.8], fov: 40, fog: 0.004 });`],
    ['hyde-ref-5', 'side, right', `m.cam({ pos: [6.4, 2.0, 44 + 1.5], look: [0, 1.25, 43.4], fov: 40, fog: 0.004 });`],
  ];
  const pairs = [];
  for (const [ref, cap, cam] of cams) {
    await run(page, cam + `m.render(2, 1/30);`);
    const f = `${OUT}/hyde-sheet-${ref}.png`;
    await page.screenshot({ path: f });
    pairs.push([`docs/overhaul/refs/${ref}.png`, f, `${ref}: ${cap} (left: owner photo, right: game model)`]);
  }
  await page.close();
  await sheet('hyde-vs-reference', pairs, 2);
}

async function crackSheet() {
  const page = await open(CASE, '', [1000, 760]);
  const pairs = [];
  const snap = async (cap, js) => {
    await run(page, js + `m.render(3, 1/30);`);
    const f = `${OUT}/crack-sheet-${pairs.length}.png`;
    await page.screenshot({ path: f });
    pairs.push(['docs/overhaul/refs/crackstone-ref.png', f, `crackstone-ref: ${cap} (left: illustration, right: game model)`]);
  };
  await run(page, stageCrack('PATROL', { yaw: Math.PI, speed: 1.5 }) + `m.setCrackFlags({ walk: true }); m.settle(0.4); m.advance(2.2, 15); m.setCrackFlags({ walk: false });`);
  await snap('patrol stride', `const c = m.run.crackstone; m.cam({ pos: [c.x - 4.0, 1.5, c.z + 4.6], look: [c.x, 1.25, c.z], fov: 34, fog: 0.004 });`);
  await run(page, stageCrack('CHASE', { yaw: Math.PI, speed: 3.8 }) + `m.setCrackFlags({ walk: true }); m.settle(0.4); m.advance(1.6, 15); m.setCrackFlags({ walk: false });`);
  await snap('chase, leaning in', `const c = m.run.crackstone; m.cam({ pos: [c.x + 4.4, 1.5, c.z + 3.6], look: [c.x, 1.25, c.z], fov: 34, fog: 0.004 });`);
  await run(page, stageCrack('ATTACK', { yaw: Math.PI }) + `m.place(0, 56, 0, 'idle'); m.settle(0.3); m.castCurse(0, 56, 3.2, 1.8); m.advance(1.45, 15);`);
  await snap('staff thrust at the curse circle', `const c = m.run.crackstone; m.cam({ pos: [c.x + 4.6, 1.6, c.z + 2.2], look: [c.x, 1.3, c.z], fov: 34, fog: 0.004 });`);
  await page.close();
  await sheet('crackstone-vs-reference', pairs, 1);
}

const SETS = { 'hyde-close': hydeClose, 'hyde-modes': hydeModes, 'crack-close': crackClose, 'crack-modes': crackModes, telegraph, cases, 'hyde-sheet': hydeSheet, 'crack-sheet': crackSheet };
const todo = SET === 'all' ? Object.keys(SETS) : [SET];
for (const s of todo) { if (SETS[s]) await SETS[s](); }
console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();

// Final-wave staging shots (Slurp, cabinets + hiding view, death cutscenes, compact map edges, spawn / despawn) through the preview harness.
//   node tools/mystery-preview-final.mjs <set> [outDir] [baseUrl] [case]
//   sets: start | slurp | cabinets | death | edges | spawn | all
// Needs the dev server (npx vite --port 5173) and PLAYWRIGHT_BROWSERS_PATH=D:\PokemonDay-cache\ms-playwright.
// Uses the designer's playArea when it exists in the real data; otherwise the harness stages a compact area (?compact=1).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const SET = process.argv[2] ?? 'all';
const OUT = process.argv[3] ?? 'output/final/3d';
const BASE = process.argv[4] ?? 'http://localhost:5173';
const CASE = process.argv[5] ?? 'poisoned_archive';
const CASES = ['poisoned_archive', 'crypt_last_witness', 'midnight_signal'];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const errors = [];

async function open(caseId, extra = '', size = [1366, 768]) {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&compact=1&case=${caseId}${extra}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mReady, null, { timeout: 90000 });
  return page;
}
const run = (page, js) => page.evaluate(`(async () => { const m = window.__m; ${js} })()`);
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); };
/** where the staged area starts / its centre line (works with the real playArea or the mock) */
const info = (page) => run(page, `const b = m.map.bounds; return { b, s: m.map.playerStart, cabs: m.map.hidingSpots.filter(h => h.kind === 'cabinet').map(h => ({ id: h.id, x: h.x, z: h.z, yaw: h.doorYaw })), tower: m.map.tower, playArea: !!m.map.world?.playArea };`);

async function start() {
  for (const cs of CASES) {
    const page = await open(cs);
    const i = await info(page);
    await run(page, `m.setEffects({}); m.cam(null); m.setHydeEmerged(false); m.place(${i.s.x}, ${i.s.z}, ${i.s.yaw}, 'idle'); m.settle(1.2); m.render(3, 1/30);`);
    await shot(page, `start-${cs}`);
    // aerial view of the whole area: the boundary walls, the treeline and the landmarks
    const cx = (i.b.minX + i.b.maxX) / 2, cz = (i.b.minZ + i.b.maxZ) / 2;
    await run(page, `m.cam({ pos: [${cx}, 70, ${i.b.maxZ + 52}], look: [${cx}, 0, ${cz}], fov: 58, fog: 0.004 }); m.render(2, 1/30);`);
    await shot(page, `aerial-${cs}`);
    await page.close();
  }
}

async function edges() {
  for (const cs of CASES) {
    const page = await open(cs);
    const i = await info(page);
    // stand at each side of the fence looking out: the boundary wall + the treeline beyond it
    const sides = [['north', (i.b.minX + i.b.maxX) / 2, i.b.minZ + 3, 0], ['east', i.b.maxX - 3, (i.b.minZ + i.b.maxZ) / 2, -Math.PI / 2], ['west', i.b.minX + 3, (i.b.minZ + i.b.maxZ) / 2, Math.PI / 2]];
    for (const [n, x, z, yaw] of sides) {
      await run(page, `m.setEffects({}); m.cam(null); m.setHydeEmerged(false); m.place(${x}, ${z}, ${yaw}, 'idle', 0.08); m.settle(1.0); m.render(3, 1/30);`);
      await shot(page, `edge-${cs}-${n}`);
    }
    await page.close();
  }
}

async function slurp() {
  const page = await open(CASE);
  const i = await info(page);
  const px = i.s.x, pz = i.s.z - 6;
  const base = `m.setHydeEmerged(false); m.setEffects({}); m.cam(null); m.place(${px}, ${pz}, 0, 'idle'); m.setPresence({ hyde: false, crackstone: false, slurp: true });`;
  const modes = [
    ['wander', 'WANDER', { speed: 1.0 }, 2.0, 7.5],
    ['investigate', 'INVESTIGATE', { speed: 0 }, 1.6, 7.5],
    ['search', 'SEARCH', { speed: 0.8 }, 1.8, 7.5],
    ['chase', 'CHASE', { speed: 3.4 }, 1.8, 6.5],
    ['windup', 'ATTACK', { speed: 0 }, 0.9, 4.2],
    ['lunge', 'ATTACK', { speed: 0, attacking: true }, 0.6, 4.2],
    ['leave', 'LEAVE', { speed: 1.2, faceAway: true }, 1.6, 7.5],
  ];
  for (const [name, mode, o, secs, dist] of modes) {
    await run(page, base + `m.slurpAt(${dist}, 0, ${JSON.stringify(mode)}, ${JSON.stringify(o)}); m.setSlurpWalk(false); m.settle(0.8); m.advance(${secs}, 15);`);
    // follow so he stays at `dist` after the fake walk
    await run(page, `const s = m.run.slurp; m.place(s.x, s.z + ${dist}, 0, 'idle'); m.render(6, 1/30);`);
    await shot(page, `slurp-${name}-game`);
    if (name === 'wander' || name === 'chase' || name === 'lunge') {
      await run(page, `const s = m.run.slurp; m.cam({ pos: [s.x + 2.6, 1.5, s.z - 2.2], look: [s.x, 1.1, s.z], fov: 42, fog: 0.004 }); m.render(2, 1/30);`);
      await shot(page, `slurp-${name}-close`);
      await run(page, `m.cam(null);`);
    }
  }
  // model sheet: front / side / rear / face
  await run(page, base + `m.slurpAt(8, 0, 'WANDER', { speed: 0 }); m.settle(1.5);`);
  const views = [['front', Math.PI, 4.2, 1.35, 1.1, 40], ['side', Math.PI / 2, 4.2, 1.35, 1.1, 40], ['rear', 0.1, 4.2, 1.35, 1.1, 40], ['face', Math.PI + 0.3, 1.0, 1.6, 1.62, 34]];
  for (const [n, a, d, hgt, ty, fov] of views) {
    await run(page, `const s = m.run.slurp; m.cam({ pos: [s.x + Math.sin(${a}) * ${d}, ${hgt}, s.z - Math.cos(${a}) * ${d}], look: [s.x, ${ty}, s.z], fov: ${fov}, fog: 0.004 }); m.render(2, 1/30);`);
    await shot(page, `slurp-sheet-${n}`);
  }
  await page.close();
}

async function cabinets() {
  for (const cs of CASES) {
    const page = await open(cs);
    const i = await info(page);
    const cab = i.cabinets ?? i.cabs;
    const c = cab[cs === 'crypt_last_witness' ? 1 : 0];
    await run(page, `m.setHydeEmerged(false); m.setEffects({}); m.cam(null); m.atCabinet(${JSON.stringify(c.id)}, 2.4); m.setInteract({ kind: 'cabinet', id: ${JSON.stringify(c.id)}, label: 'Hide', progress: 0 }); m.settle(1.2); m.render(4, 1/30);`);
    await shot(page, `cabinet-${cs}-closed-prompt`);
    // model close-up (the player and companion stay far away): door closed, then ajar
    await run(page, `m.setInteract(null); m.cam(null); m.place(${i.s.x}, ${i.s.z}, 0, 'idle'); m.settle(0.3);`);
    const camAt = `{ const sp = m.map.hidingSpots.find(h => h.id === ${JSON.stringify(c.id)}); const a = sp.doorYaw + 0.55; m.cam({ pos: [sp.x - Math.sin(a) * 3.0, 1.45, sp.z - Math.cos(a) * 3.0], look: [sp.x, 1.05, sp.z], fov: 44, fog: 0.004 }); m.render(2, 1/30); }`;
    await run(page, camAt);
    await shot(page, `cabinet-${cs}-model-closed`);
    await run(page, `m.emit({ type: 'cabinet', spotId: ${JSON.stringify(c.id)}, action: 'open', loud: false }); m.advance(0.5, 30); ` + camAt);
    await shot(page, `cabinet-${cs}-model-ajar`);
    // enter: door opens, avatar steps in, camera moves inside (3 frames across the transition)
    await run(page, `m.cam(null); m.setCabinet(${JSON.stringify(c.id)}, 'entering'); m.advance(0.12, 30);`);
    await shot(page, `cabinet-${cs}-enter-1`);
    await run(page, `m.advance(0.18, 30);`);
    await shot(page, `cabinet-${cs}-enter-2`);
    await run(page, `m.setCabinet(${JSON.stringify(c.id)}, 'open'); m.advance(0.9, 30);`);
    await shot(page, `cabinet-${cs}-hiding-open`);
    await run(page, `m.setCabinet(${JSON.stringify(c.id)}, 'closed'); m.advance(0.9, 30);`);
    await shot(page, `cabinet-${cs}-hiding-closed`);
    // a monster outside the door while hidden
    await run(page, `m.setPresence({ hyde: false, crackstone: false, slurp: true }); const sp = m.map.hidingSpots.find(h => h.id === ${JSON.stringify(c.id)}); m.setSlurp({ active: true, x: sp.x - Math.sin(sp.doorYaw) * 4, z: sp.z - Math.cos(sp.doorYaw) * 4, yaw: sp.doorYaw + Math.PI, mode: 'SEARCH', speed: 0.7 }); m.advance(1.5, 15);`);
    await shot(page, `cabinet-${cs}-hiding-closed-slurp`);
    await run(page, `m.setCabinet(${JSON.stringify(c.id)}, 'exiting'); m.advance(0.25, 30);`);
    await shot(page, `cabinet-${cs}-exit-1`);
    await run(page, `m.setCabinet(null); m.atCabinet(${JSON.stringify(c.id)}, 1.5); m.advance(0.7, 30);`);
    await shot(page, `cabinet-${cs}-exited`);
    // pulled out
    await run(page, `m.setCabinet(${JSON.stringify(c.id)}, 'closed'); m.advance(0.8, 30); m.setCabinet(null); m.atCabinet(${JSON.stringify(c.id)}, 1.2); m.emit({ type: 'cabinet', spotId: ${JSON.stringify(c.id)}, action: 'pulled_out', loud: true }); m.advance(0.12, 30);`);
    await shot(page, `cabinet-${cs}-pulled-out`);
    await page.close();
  }
}

async function death() {
  for (const enemy of ['hyde', 'crackstone', 'slurp']) {
    const page = await open(CASE);
    const i = await info(page);
    const px = i.s.x, pz = i.s.z - 8;
    const times = { hyde: [0.9, 1.45, 1.95, 2.08, 2.6], crackstone: [0.6, 1.4, 2.3, 3.4, 3.9], slurp: [0.9, 1.9, 2.3, 2.6, 3.1] }[enemy];
    await run(page, `m.setHydeEmerged(${enemy === 'hyde' ? 'true' : 'false'}); m.setEffects({}); m.cam(null); m.place(${px}, ${pz}, 0, 'idle'); m.setPresence(${JSON.stringify({ hyde: enemy === 'hyde', crackstone: enemy === 'crackstone', slurp: enemy === 'slurp' })});
      ${enemy === 'hyde' ? `m.hydeAt(5, 0.2, 'CHASE', { speed: 0 });` : enemy === 'crackstone' ? `m.crackAt(6, 0, 'CHASE');` : `m.slurpAt(3, 0.2, 'CHASE');`}
      m.setStatus('dnf'); m.settle(0.5); m.render(2, 1/30); m.startDeath(${JSON.stringify(enemy)}, false);`);
    let t = 0;
    for (const target of times) {
      await run(page, `m.advance(${(target - t).toFixed(3)}, 30);`);
      t = target;
      await shot(page, `death-${enemy}-${String(Math.round(target * 10)).padStart(2, '0')}`);
    }
    await run(page, `m.advance(${(5 - t).toFixed(3)}, 30);`);
    console.log(enemy, JSON.stringify(await run(page, `return m.deathState();`)));
    await run(page, `m.stopDeath(); m.setStatus('playing');`);
    // skip path + reduced motion
    await run(page, `m.startDeath(${JSON.stringify(enemy)}, true); m.advance(0.6, 30);`);
    await shot(page, `death-${enemy}-reduced`);
    await run(page, `m.advance(1.0, 30);`);
    console.log(enemy, 'reduced', JSON.stringify(await run(page, `return m.deathState();`)));
    await page.close();
  }
}

async function spawn() {
  const page = await open(CASE);
  const i = await info(page);
  const px = i.s.x, pz = i.s.z - 8;
  for (const enemy of ['hyde', 'crackstone', 'slurp']) {
    const setup = enemy === 'hyde' ? `m.hydeAt(7, 0, 'PATROL', { speed: 0 });` : enemy === 'crackstone' ? `m.crackAt(7, 0, 'PATROL', { speed: 0 });` : `m.slurpAt(7, 0, 'WANDER', { speed: 0 });`;
    await run(page, `m.setHydeEmerged(true); m.setEffects({}); m.cam(null); m.place(${px}, ${pz}, 0, 'idle'); m.setPresence({ hyde: false, crackstone: false, slurp: false }); ${setup} m.render(4, 1/30);`);
    await run(page, `m.setPresence({ ${enemy}: true }); m.emit({ type: 'enemy_spawned', enemy: ${JSON.stringify(enemy)}, spawnId: 'x', x: 0, z: 0 }); m.advance(0.5, 20);`);
    await shot(page, `spawn-${enemy}-a`);
    await run(page, `m.advance(0.7, 20);`);
    await shot(page, `spawn-${enemy}-b`);
    await run(page, `m.advance(1.6, 20);`);
    await shot(page, `spawn-${enemy}-c`);
    await run(page, `m.setPresence({ ${enemy}: false }); m.emit({ type: 'enemy_despawned', enemy: ${JSON.stringify(enemy)}, reason: 'far' }); m.advance(0.7, 20);`);
    await shot(page, `despawn-${enemy}-a`);
    await run(page, `m.advance(1.2, 20);`);
    await shot(page, `despawn-${enemy}-b`);
  }
  await page.close();
}

const SETS = { start, edges, slurp, cabinets, death, spawn };
const todo = SET === 'all' ? Object.keys(SETS) : [SET];
for (const s of todo) { if (SETS[s]) await SETS[s](); }
console.log('errors:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();

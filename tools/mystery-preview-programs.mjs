// Shader-program audit for the final wave: no program may be compiled after warmUp (Slurp, cabinets, cutscenes, spawn effects, fades).
//   node tools/mystery-preview-programs.mjs [baseUrl] [case]
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:5261';
const CASE = process.argv[3] ?? 'poisoned_archive';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`${BASE}/tools/mystery-preview.html?manual=1&shot=1&compact=1&case=${CASE}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__mReady, null, { timeout: 90000 });
const run = (js) => page.evaluate(`(async () => { const m = window.__m; ${js} })()`);
const progs = async (label) => { const d = await run(`const d = m.debug(); return { programs: d.programs, warm: d.programsAfterWarmUp };`); console.log(label.padEnd(34), JSON.stringify(d)); return d; };
await run(`const s = m.map.playerStart; m.setSlurp({ x: s.x, z: s.z - 12, yaw: 0, mode: 'WANDER' }); m.setCrack({ x: s.x + 6, z: s.z - 14, yaw: 0 }); m.setPresence({ hyde: true, crackstone: true, slurp: true }); m.render(3, 1/30);`);
await page.waitForTimeout(4000); await run(`m.advance(0.3, 30);`); // let the companion artwork / model arrive (it re-warms the programs by itself)
const base = await progs('after warm');
const cab = (await run(`return m.map.hidingSpots.find(h => h.kind === 'cabinet')?.id ?? null;`));
await run(`const c = ${JSON.stringify(cab)}; m.atCabinet(c, 1.6); m.setInteract({ kind: 'cabinet', id: c, label: 'Hide', progress: 0 }); m.advance(0.4, 30); m.setCabinet(c, 'entering'); m.advance(0.4, 30); m.setCabinet(c, 'open'); m.advance(0.6, 30); m.setCabinet(c, 'closed'); m.advance(0.8, 30);`);
await progs('cabinet in/closed');
await run(`const c = ${JSON.stringify(cab)}; m.setCabinet(c, 'exiting'); m.advance(0.4, 30); m.setCabinet(null); m.emit({ type: 'cabinet', spotId: c, action: 'pulled_out', loud: true }); m.advance(0.5, 30);`);
await progs('cabinet exit / pulled out');
for (const mode of ['WANDER', 'INVESTIGATE', 'SEARCH', 'CHASE', 'ATTACK', 'LEAVE']) await run(`m.slurpAt(5, 0, '${mode}', { attacking: false }); m.advance(0.4, 30);`);
await run(`m.slurpAt(3, 0, 'CHASE'); m.advance(0.5, 30);`);
await progs('slurp modes');
await run(`m.setPresence({ hyde: false, crackstone: false, slurp: false }); m.emit({ type: 'enemy_despawned', enemy: 'slurp', reason: 'far' }); m.advance(1.5, 20); m.setPresence({ hyde: true, crackstone: true, slurp: true }); m.emit({ type: 'enemy_spawned', enemy: 'crackstone', spawnId: 'a', x: 0, z: 0 }); m.advance(2.0, 20);`);
await progs('spawn / despawn fades');
for (const e of ['hyde', 'crackstone', 'slurp']) { await run(`m.setStatus('dnf'); m.startDeath('${e}', false); m.advance(4.6, 30); m.stopDeath(); m.setStatus('playing'); m.advance(0.5, 30);`); await progs('death ' + e); }
await run(`m.startDeath('slurp', true); m.advance(1.5, 30); m.stopDeath(); m.advance(0.3, 30);`);
const fin = await progs('death reduced');
console.log(fin.programs === base.programs ? 'PASS: no program compiled after warm-up' : `FAIL: +${fin.programs - base.programs} programs`);
console.log('errors:', errs.length ? errs.slice(0, 5) : 'none');
await browser.close();

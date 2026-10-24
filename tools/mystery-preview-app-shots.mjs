// Real-game screenshots + frame timing per case through the app (autopilot drives the real sim). Usage:
//   node tools/mystery-preview-app-shots.mjs [outDir] [baseUrl] [cases=all|id,id] [low=0|1] [marks=25,60,100]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const OUT = process.argv[2] ?? 'output/overhaul/3d/app';
const BASE = process.argv[3] ?? 'http://localhost:5173';
const CASES = (process.argv[4] ?? 'all') === 'all' ? ['poisoned_archive', 'crypt_last_witness', 'midnight_signal'] : process.argv[4].split(',');
const LOW = process.argv[5] === '1';
const MARKS = (process.argv[6] ?? '12,40,75,110').split(',').map(Number);
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const errs = [];
const report = {};
for (const c of CASES) {
  const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
  p.on('pageerror', (e) => errs.push(`${c}: ${e}`));
  p.on('console', (m) => m.type() === 'error' && errs.push(`${c}: ${m.text()}`));
  const st = async () => JSON.parse(await p.evaluate(() => window.render_game_to_text()));
  await p.goto(`${BASE}/?mode=mystery&character=wednesday&pokemon=gengar&seed=shots-${c}&case=${c}&tutorial=0${LOW ? '&low=1' : ''}`);
  await p.waitForFunction(() => JSON.parse(window.render_game_to_text()).play?.phase === 'ready', null, { timeout: 90000 });
  await p.evaluate(() => window.advanceTime(2500)); await p.waitForTimeout(400);
  const tag = `${c}${LOW ? '-low' : ''}`;
  await p.screenshot({ path: `${OUT}/${tag}-0-start.png` });
  const frames = [];
  await p.evaluate(() => window.mysteryAutopilot('stealthy'));
  let s = await st(); let k = 0;
  for (let i = 0; i < 120 && s.screen === 'play'; i++) {
    await p.evaluate(() => window.advanceTime(1000)); s = await st();
    if (k < MARKS.length && s.run.t >= MARKS[k]) {
      await p.waitForTimeout(250);
      await p.screenshot({ path: `${OUT}/${tag}-${k + 1}-t${Math.round(s.run.t)}-${s.run.objective}.png` });
      const d = s.scene ?? null;
      frames.push({ t: Math.round(s.run.t), obj: s.run.objective, calls: d?.drawCalls, tris: d?.triangles, vis: d?.world?.evidenceVisible, egg: d?.world?.eggVisible, hyde: d?.hydeEmerged, theme: d?.theme });
      k++;
    }
  }
  report[tag] = { ended: s.screen, t: s.run?.t ?? s.result?.activeTimeS, frames };
  await p.close();
}
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report));
console.log('errors', errs.length ? errs.slice(0, 10).join('\n') : 'none');
await b.close();

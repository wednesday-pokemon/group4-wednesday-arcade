// Dumps what the renderer draws per frame in the production app: visible meshes grouped by owner (draw-call census) and node counts.
// Usage: BASE=http://localhost:4174 CASE=midnight_signal node tools/mystery-preview-scenedump.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:4174';
const CASE = process.env.CASE ?? 'midnight_signal';
const DUO = { poisoned_archive: ['wednesday', 'gengar'], crypt_last_witness: ['enid', 'dragapult'], midnight_signal: ['ajax', 'chandelure'] }[CASE];
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1366, height: 768 } });
await p.goto(`${BASE}/?mode=mystery&character=${DUO[0]}&pokemon=${DUO[1]}&seed=dump-${CASE}&case=${CASE}&tutorial=0&scenedebug=1`);
await p.waitForFunction(() => JSON.parse(window.render_game_to_text?.() ?? 'null')?.play?.phase === 'ready', null, { timeout: 120000 });
await p.mouse.click(683, 384);
await p.keyboard.down('KeyW');
await p.evaluate(() => window.advanceTime(24000));
await p.waitForTimeout(1500);
const r = await p.evaluate(() => {
  const sc = window.__mysteryScene, scene = sc.scene, cam = sc.camera;
  let nodes = 0, visNodes = 0, meshes = 0, visMeshes = 0, lights = 0, skinned = 0, instanced = 0, transparent = 0, tris = 0;
  const owner = new Map();
  const roots = [['world', sc.world.root], ['avatar', sc.avatar.root], ['companion', sc.companion.root], ['hyde', sc.hyde.root], ['crack', sc.crack?.root], ['thing', sc.thing.root], ['thingHint', sc.thingHint.root], ['egg', sc.egg.root], ['view', sc.view.root], ['searchlights', sc.searchlights?.root]].filter((x) => x[1]);
  const tag = (o) => { for (const [n, r] of roots) { for (let q = o; q; q = q.parent) if (q === r) return n; } return o.type === 'Points' ? 'points' : o.isInstancedMesh ? 'instanced:' + (o.geometry?.type ?? '') : o.isSprite ? 'sprite' : 'other:' + o.type + (o.material?.type ? ':' + o.material.type : ''); };
  scene.traverse((o) => { nodes++; if (o.isLight) lights++; });
  scene.traverseVisible((o) => {
    visNodes++;
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
      visMeshes++;
      const k = tag(o);
      const g = o.geometry;
      const t = g ? (g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3 * (o.isInstancedMesh ? o.count : 1) : 0;
      const e = owner.get(k) ?? { meshes: 0, tris: 0, skinned: 0, transparent: 0 };
      e.meshes++; e.tris += Math.round(t); if (o.isSkinnedMesh) e.skinned++; if (o.material?.transparent) e.transparent++;
      owner.set(k, e);
    }
  });
  return { nodes, visNodes, visMeshes, lights, owners: [...owner].sort((a, b) => b[1].meshes - a[1].meshes).map(([k, v]) => `${k}: ${v.meshes} meshes ${v.tris} tris${v.skinned ? ' skinned ' + v.skinned : ''}${v.transparent ? ' transp ' + v.transparent : ''}`), info: { calls: sc.renderer.info.render.calls, tris: sc.renderer.info.render.triangles, programs: sc.renderer.info.programs.length, geos: sc.renderer.info.memory.geometries, tex: sc.renderer.info.memory.textures } };
});
console.log(JSON.stringify(r, null, 1));
await b.close();

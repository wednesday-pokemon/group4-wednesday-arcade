// Leakage guard (OVERHAUL_CONTRACT "Analytics"; UX_OVERHAUL "Guard"): player-facing analytics never read the session's
// hidden truth — `run.layout`, `map.clues`, `map.eggSpawn`, a resting egg's position — nor the sim's draw helpers.
//   1. Source scan of src/mystery/analytics/** (comments stripped): forbidden reads / imports.
//   2. Behaviour: two runs with the SAME seed but DIFFERENT forced hidden layouts give identical live analytics (egg and
//      clue odds, advice, hint ladder targets) until the player has observed something.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMysteryAnalytics } from '../../../src/mystery/analytics/index.ts';
import { CASES } from '../../../src/mystery/data/cases.ts';
import { IDLE_INPUT, MysteryRun } from '../../../src/mystery/run.ts';
import { CASE_IDS, type CaseWorldDef, type SessionLayout } from '../../../src/mystery/types.ts';
import { caseMap } from '../../../src/mystery/defaults.ts';

const ROOT = 'src/mystery/analytics';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  }).filter((f) => f.endsWith('.ts'));
}

/** Source without comments (line + block) and string contents kept (they are not reads). */
function code(text: string): string {
  // checked-out files may be CRLF (git autocrlf): normalise first so `.*$` reaches the end of a comment line
  return text.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
}

const FORBIDDEN: { re: RegExp; why: string }[] = [
  { re: /\.layout\b/, why: 'reads the hidden session layout' },
  { re: /\bmap\.clues\b|\.map\.clues\b/, why: 'reads the hidden clue placement' },
  { re: /\beggSpawn\b/, why: 'reads the hidden egg site' },
  { re: /from '\.\.\/layout(\.ts)?'/, why: 'imports the sim draw helpers' },
  { re: /\b(drawLayout|traceSiteFor|drawHydeSpawn|layoutFromMap|sessionMap)\b/, why: 'uses a sim draw helper' },
];

describe("R4: Crackstone's position is used only while the player may know it", () => {
  it('source scan: only publicState.ts reads his runtime (run.crackstone / brain.c); nothing reads his bearing', () => {
    for (const f of files(ROOT)) {
      const src = code(readFileSync(f, 'utf8'));
      const own = f.replace(/\\/g, '/').endsWith('analytics/publicState.ts');
      const runtime = /\brun\.crackstone\b(?!Brain|Def|Present|Visible)|crackstoneBrain[!?]?\.c\b|\bbrain[!?]?\.c\b/.exec(src);
      if (!own) expect(runtime, `${f} reads Crackstone's runtime directly: "${runtime?.[0]}"`).toBeNull();
      expect(/crackstoneBearing/.test(src), `${f} reads his bearing`).toBe(false);
    }
  });

  it('behaviour: moving him while he is unseen (not chasing, no reveal) changes nothing; moving him into view does', () => {
    let compared = 0;
    for (const caseId of CASE_IDS) {
      const make = () => {
        const run = new MysteryRun({ duo: { characterId: 'morticia', pokemonId: 'aegislash' }, seed: `r4-${caseId}`, tutorial: false, caseDef: CASES[caseId] });
        return { run, a: createMysteryAnalytics(run) };
      };
      const A = make();
      const B = make();
      const C = make();
      const step = (x: ReturnType<typeof make>) => x.a.frame(x.run, x.run.update(0.25, IDLE_INPUT));
      // the director brings him in (first appearance); standing still at the start he patrols out of sight
      for (let i = 0; i < 400 && !(A.run.crackstoneBrain?.active && i > 16); i++) [A, B, C].forEach(step);
      const p = A.run.player;
      if (!A.run.crackstoneBrain?.active || A.run.crackstoneVisible() || A.run.crackstone!.mode !== 'PATROL') continue;
      // B: teleport him to another hidden spot (a waypoint the player cannot see); C: into the player's view
      const hiddenWp = A.run.crackstoneDef!.patrol.find((w) => Math.hypot(w.x - p.x, w.z - p.z) > 20 && Math.hypot(w.x - A.run.crackstone!.x, w.z - A.run.crackstone!.z) > 6
        && !A.run.world.lineOfSight(p.x, p.z, w.x, w.z));
      if (!hiddenWp) continue;
      Object.assign(B.run.crackstone!, { x: hiddenWp.x, z: hiddenWp.z, yaw: B.run.crackstone!.yaw + 2 });
      const nav = C.run.playerNav();
      let view = nav.nearestWalkable({ x: p.x + 8, z: p.z }, 4)!;
      for (let k = 0; k < 16; k++) {
        const q = nav.nearestWalkable({ x: p.x + Math.cos(k * 0.39) * 8, z: p.z + Math.sin(k * 0.39) * 8 }, 2);
        if (q && C.run.world.lineOfSight(p.x, p.z, q.x, q.z)) {
          view = q;
          break;
        }
      }
      Object.assign(C.run.crackstone!, { x: view.x, z: view.z });
      const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (key, v) => (key === 'id' ? undefined : v)));
      let differs = false;
      for (let i = 0; i < 12; i++) {
        const eA = A.run.update(0.25, IDLE_INPUT);
        const eB = B.run.update(0.25, IDLE_INPUT);
        const eC = C.run.update(0.25, IDLE_INPUT);
        A.a.frame(A.run, eA);
        B.a.frame(B.run, eB);
        C.a.frame(C.run, eC);
        expect(B.run.crackstoneVisible()).toBe(false);
        expect(strip(eB.filter((e) => e.type !== 'noise'))).toEqual(strip(eA.filter((e) => e.type !== 'noise')));
        const LA = A.a.live();
        const LB = B.a.live();
        expect(strip(LB.forecasts)).toEqual(strip(LA.forecasts));
        expect(strip(LB.messages)).toEqual(strip(LA.messages));
        expect(strip(LB.advice)).toEqual(strip(LA.advice));
        expect(strip(B.a.heartbeat())).toEqual(strip(A.a.heartbeat()));
        expect(strip(B.a.prescriptive.candidates(B.run, B.a.engine.zones(), LB.forecasts.crackstone ?? null))).toEqual(strip(A.a.prescriptive.candidates(A.run, A.a.engine.zones(), LA.forecasts.crackstone ?? null)));
        if (C.run.crackstoneVisible() && JSON.stringify(strip(C.a.live().forecasts.crackstone)) !== JSON.stringify(strip(LA.forecasts.crackstone))) differs = true;
      }
      expect(differs, `${caseId}: the forecast reacts to a PUBLIC sighting`).toBe(true);
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });
});

describe('final: Slurp position only per R4; director internals never read', () => {
  it('source scan: only publicState.ts reads run.slurp / slurpBrain; no director internals (rng, lives, recent, draws, spawnAt)', () => {
    for (const f of files(ROOT)) {
      const src = code(readFileSync(f, 'utf8'));
      const own = f.replace(/\\/g, '/').endsWith('analytics/publicState.ts');
      const slurp = /\brun\.slurp\b(?!Def|Present|Visible|Effects)|slurpBrain|\bslurpBearing\b|lastSlurpSighting/.exec(src);
      if (!own) expect(slurp, `${f} reads Slurp's runtime directly: "${slurp?.[0]}"`).toBeNull();
      const dir = /director[!?]?\.(rng|lives|recent|step|spawnAt|markSpawned|enemies)\b|\b(drawEncounterSpawn|pickCumulative|pickByWeight)\b|from '\.\.\/director(\.ts)?'/.exec(src);
      expect(dir, `${f} reads director internals: "${dir?.[0]}"`).toBeNull();
      // the cabinet a monster remembers is public only as cabinetStatus().witnessedBy (no brain memory reads)
      expect(/cabinetGoal|cabinetMemory/.exec(src), `${f} reads an enemy's cabinet memory`).toBeNull();
    }
  });

  it('behaviour: moving Slurp while unseen (not chasing, no reveal) changes no live output', () => {
    let compared = 0;
    for (const caseId of CASE_IDS) {
      const make = () => {
        const run = new MysteryRun({ duo: { characterId: 'morticia', pokemonId: 'aegislash' }, seed: `r4s-${caseId}`, tutorial: false, caseDef: CASES[caseId] });
        return { run, a: createMysteryAnalytics(run) };
      };
      const A = make();
      const B = make();
      const step = (x: ReturnType<typeof make>) => x.a.frame(x.run, x.run.update(0.25, IDLE_INPUT));
      // wait (standing still) until Slurp is on the map
      for (let i = 0; i < 400 && !(A.run.slurp?.active); i++) [A, B].forEach(step);
      if (!A.run.slurp?.active || A.run.slurpVisible() || A.run.slurp.mode === 'CHASE' || A.run.slurp.mode === 'ATTACK') continue;
      const p = A.run.player;
      const wp = A.run.slurpDef!.wander.find((w) => Math.hypot(w.x - p.x, w.z - p.z) > 25 && Math.hypot(w.x - A.run.slurp!.x, w.z - A.run.slurp!.z) > 5 && !A.run.world.lineOfSight(p.x, p.z, w.x, w.z));
      if (!wp) continue;
      Object.assign(B.run.slurp!, { x: wp.x, z: wp.z });
      const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (key, v) => (key === 'id' ? undefined : v)));
      for (let i = 0; i < 3; i++) {
        const eA = A.run.update(0.25, IDLE_INPUT);
        const eB = B.run.update(0.25, IDLE_INPUT);
        A.a.frame(A.run, eA);
        B.a.frame(B.run, eB);
        if (B.run.slurpVisible() || A.run.slurpVisible() || B.run.slurp!.mode !== A.run.slurp!.mode) break;
        expect(strip(B.a.live().forecasts)).toEqual(strip(A.a.live().forecasts));
        expect(strip(B.a.heartbeat())).toEqual(strip(A.a.heartbeat()));
      }
      compared++;
    }
    expect(compared).toBeGreaterThan(0);
  });
});

describe('leakage guard: analytics never read the hidden truth', () => {
  it('source scan: no layout / map.clues / eggSpawn reads, no draw helpers, egg position only through publicEggPosition', () => {
    const all = files(ROOT);
    expect(all.length).toBeGreaterThan(15);
    for (const f of all) {
      const src = code(readFileSync(f, 'utf8'));
      for (const { re, why } of FORBIDDEN) {
        const m = re.exec(src);
        expect(m, `${f} ${why}: "${m?.[0]}"`).toBeNull();
      }
      // a resting egg's x/z is hidden truth: the only egg-position read is the marked line in publicState.ts
      const eggReads = src.split('\n').filter((l) => /\begg\.(x|z)\b/.test(l));
      if (f.replace(/\\/g, '/').endsWith('analytics/publicState.ts')) expect(eggReads.length).toBe(1);
      else expect(eggReads, `${f} reads the egg position directly`).toEqual([]);
    }
    const pub = readFileSync(join(ROOT, 'publicState.ts'), 'utf8');
    expect(pub).toMatch(/egg\.state === 'carried' \|\| egg\.state === 'dropped' \|\| egg\.state === 'delivered'\) return \{ x: egg\.x, z: egg\.z \}; \/\/ public egg position/);
  });

  it('behaviour: live analytics are identical for two different hidden layouts until something is observed', () => {
    let compared = 0;
    for (const caseId of CASE_IDS) {
      const world = caseMap(caseId).world as CaseWorldDef;
      // the two most different layouts: first vs last candidate site of every group and of the egg
      const pick = (k: 'first' | 'last'): SessionLayout => ({
        clueSites: Object.fromEntries(world.clueSites.map((g) => [g.clueId, (k === 'first' ? g.sites[0] : g.sites[g.sites.length - 1]).id])),
        eggSiteId: (k === 'first' ? world.eggSites[0] : world.eggSites[world.eggSites.length - 1]).id,
      });
      const outs = (['first', 'last'] as const).map((k) => {
        const run = new MysteryRun({ duo: { characterId: 'wednesday', pokemonId: 'chandelure' }, seed: `leak-${caseId}`, tutorial: false, caseDef: CASES[caseId], layout: pick(k) });
        const a = createMysteryAnalytics(run);
        for (let i = 0; i < 8; i++) a.frame(run, run.update(0.25, IDLE_INPUT)); // standing on the pier: nothing observed
        const inv = (run as unknown as { investigation(): { checkedClueSites: string[]; checkedEggSites: string[]; traces: unknown[]; eggSeenAt: string | null } }).investigation();
        expect(inv.checkedClueSites.length + inv.checkedEggSites.length + inv.traces.length).toBe(0);
        expect(inv.eggSeenAt).toBeNull();
        const L = a.live();
        const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (key, v) => (key === 'id' ? undefined : v)));
        return {
          egg: strip(L.forecasts.egg), clues: strip(L.forecasts.clueAreas), hyde: strip(L.forecasts.hyde), advice: strip(L.advice),
          hints: [1, 2, 3].map((l) => strip(a.hint(l as 1 | 2 | 3, { requested: false }))),
        };
      });
      expect(outs[1]).toEqual(outs[0]);
      compared++;
    }
    expect(compared).toBe(3);
  });
});

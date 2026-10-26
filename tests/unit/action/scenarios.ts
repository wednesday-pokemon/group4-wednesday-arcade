// Scripted player archetypes for Hyde balance (D-32): an autopilot on one of the lake's routes, rowing at a fixed
// cadence, optionally pausing or crashing on schedule, and a recorder for the gap metrics the acceptance targets use.
import type { StageOneRun } from '../../../src/action/run.ts';
import type { ActionEvent, Obstacle, Vec2 } from '../../../src/action/types.ts';
import type { CharacterId, PokemonId } from '../../../src/game/types.ts';
import { Autopilot, FPS, newRun } from './helpers.ts';
import type { CourseDef } from '../../../src/action/types.ts';

export interface Archetype {
  name: string;
  tapsPerS: number;
  /** Stop rowing (oars up, no steering) for `stopS` every `everyS`, starting at the first stop after the Hyde hunts. */
  stops?: { everyS: number; stopS: number };
  /** Crash into a rock (dropped 5 u ahead) when course progress first passes each fraction. */
  crashAtProgress?: readonly number[];
  /** Crash every `everyS` seconds while a surge burst is on (the "panicking in a surge" player). */
  crashDuringSurgeEveryS?: number;
  useQInRescue?: boolean;
  /** Press Q whenever it is ready while the Hyde hunts. */
  spamQ?: boolean;
  /** Never row at all. */
  idle?: boolean;
}

export interface SurgeDip {
  gapAtBurst: number;
  minGap: number;
}

export interface ScenarioResult {
  status: StageOneRun['status'];
  t: number;
  catches: number;
  grabs: number;
  closeCalls: number;
  crashes: number;
  dangerS: number;
  /** Median gap while plainly chasing (no surge, ≥ 8 s after emergence / a surge / a stun). */
  steadyGap: number;
  /** Minimum gap from each surge burst until 5 s after it ends. */
  surges: SurgeDip[];
  minGap: number;
  run: StageOneRun;
  events: ActionEvent[];
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Drops a hard rock 5 u ahead of the bow (in the run's private live obstacle list) and returns its id. */
export function dropRockAhead(run: StageOneRun, n: number): string {
  const b = run.boat;
  const id = `crash_rig_${n}`;
  const rock: Obstacle = { id, kind: 'rock', x: b.x - Math.sin(b.heading) * 5, z: b.z - Math.cos(b.heading) * 5, radius: 1.6, halfLength: 0, angle: 0, damage: 12 };
  (run as unknown as { activeObstacles: Obstacle[] }).activeObstacles.push(rock);
  return id;
}

export function removeRock(run: StageOneRun, id: string): void {
  const live = (run as unknown as { activeObstacles: Obstacle[] }).activeObstacles;
  const i = live.findIndex((o) => o.id === id);
  if (i >= 0) live.splice(i, 1);
}

export function runScenario(course: CourseDef, path: Vec2[], a: Archetype, characterId: CharacterId = 'wednesday', pokemonId: PokemonId = 'alolan_marowak', maxS = 300): ScenarioResult {
  const run = newRun(characterId, pokemonId, course);
  let stopFrom = Infinity;
  const ap = new Autopilot(run, {
    tapsPerS: a.idle ? 0 : a.tapsPerS,
    path,
    useQInRescue: a.useQInRescue,
    rowingAt: (t, r) => {
      if (a.idle) return false;
      if (!a.stops) return true;
      if (stopFrom === Infinity && r.hydeAI.hunting) stopFrom = t + a.stops.everyS / 2;
      return !(t >= stopFrom && (t - stopFrom) % a.stops.everyS < a.stops.stopS);
    },
  });
  const events: ActionEvent[] = [];
  const steady: number[] = [];
  const surges: SurgeDip[] = [];
  let open: SurgeDip | null = null;
  let openUntil = -Infinity;
  let quietSince = Infinity; // last time a surge/stun/emergence ended
  let minGap = Infinity;
  let crashes = 0;
  let nextCrash = 0;
  let lastSurgeCrash = -Infinity;
  let rig: string | null = null;
  const dt = 1 / FPS;
  for (let i = 0; i < maxS * FPS && run.status !== 'finished' && run.status !== 'dnf'; i++) {
    const ai = run.hydeAI;
    const playing = run.status === 'playing';
    // scheduled crashes
    if (playing && !rig && run.swampedLeftS() === 0) {
      const due = a.crashAtProgress && nextCrash < a.crashAtProgress.length && ai.hunting && run.progress >= a.crashAtProgress[nextCrash];
      const surgeDue = a.crashDuringSurgeEveryS !== undefined && ai.surgeBursting && run.t - lastSurgeCrash >= a.crashDuringSurgeEveryS;
      if (due || surgeDue) {
        if (due) nextCrash++;
        if (surgeDue) lastSurgeCrash = run.t;
        rig = dropRockAhead(run, crashes);
      }
    }
    const input = ap.input(dt);
    if (a.spamQ && playing && ai.hunting && run.abilityStatus().ready) input.ability = true;
    const ev = run.update(dt, input);
    events.push(...ev);
    if (rig && ev.some((e) => e.type === 'collision' && e.obstacleId === rig)) {
      crashes++;
      removeRock(run, rig);
      rig = null;
    }
    // metrics (sim-time based; skipped inside the rescue window)
    if (run.status !== 'playing' || !ai.hunting) continue;
    const gap = ai.gap;
    const phase = run.hyde.phase;
    if (phase === 'stunned' || phase === 'distracted' || phase === 'emerging' || ai.surgeBursting || ai.telegraphing) quietSince = run.t;
    else if (quietSince === Infinity) quietSince = run.t;
    minGap = Math.min(minGap, gap);
    if (ai.surgeBursting && !open) {
      open = { gapAtBurst: gap, minGap: gap };
      surges.push(open);
    }
    if (open) {
      open.minGap = Math.min(open.minGap, gap);
      if (ai.surgeBursting) openUntil = run.t + 5;
      else if (run.t > openUntil) open = null;
    }
    if (phase === 'chasing' && run.t - quietSince >= 8) steady.push(gap);
  }
  if (rig) removeRock(run, rig);
  return {
    status: run.status,
    t: run.t,
    catches: run.catches,
    grabs: events.filter((e) => e.type === 'hyde_catch').length,
    closeCalls: run.stats.hydeCloseCalls,
    crashes,
    dangerS: run.stats.timeInDangerS,
    steadyGap: median(steady),
    surges,
    minGap,
    run,
    events,
  };
}

export function describeResult(name: string, r: ScenarioResult): string {
  const dips = r.surges.map((s) => `${s.gapAtBurst.toFixed(0)}→${s.minGap.toFixed(1)}`).join(' ');
  return `${name}: ${r.status} ${r.t.toFixed(1)}s grabs=${r.grabs} catches=${r.catches} closeCalls=${r.closeCalls} crashes=${r.crashes} ` +
    `steady=${r.steadyGap.toFixed(1)} min=${r.minGap.toFixed(1)} danger=${r.dangerS.toFixed(1)}s surges[${dips}]`;
}

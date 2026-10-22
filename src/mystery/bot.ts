// Scripted autopilot for MysteryRun: plays a whole visit through the nav graph (3 clues → egg → Iago Tower → accuse).
// Used by tests and by the Phase 4 analytics generator for seeded simulated episodes. Every random choice is drawn from
// a seeded stream (`Rng(seed, 'bot')`), and the sim itself is deterministic, so (duo, seed, options) → identical episode.
// The bot reads only what a player can perceive (Hyde position / mode / suspicion meter, its own state); it never reads
// the seed draws.
//
// ── Phase 4 usage ────────────────────────────────────────────────────────────────────────────────────────────────────
//   import { playEpisode, type BotEpisode } from '../episode.ts';   (episode.ts holds the driver + the answer keys)
//   const ep: BotEpisode = playEpisode({ characterId: 'enid', pokemonId: 'gengar' }, 'sim-000123', { profile: 'careless',
//     sprintProb: 0.3, useAbilities: true });
//   ep.events     StampedEvent[]  the run log (seq 1…n, t = active seconds) — exactly what a live session records
//   ep.snapshots  StateSnapshot[] 1 Hz samples taken BEFORE each step at t = 0, 1, 2, … (only past/present info)
//   ep.result     RunResult | null (null only when timedOut)
//   ep.timedOut   true if the run was still playing at maxTimeS (should not happen; treat as a separate class)
//   ep.activeTimeS, ep.duo, ep.seed, ep.profile, ep.run (the finished MysteryRun, for extra introspection)
// Label for "detected within 15 s" at snapshot time t: any event with type 'hyde_mode' && to === 'CHASE' (or a
// 'hyde_sighted') with t < e.t ≤ t + 15. Group train/holdout splits by `seed` (one episode per seed).
// Vary episodes with: profile, sprintProb, crouchNearHydeM, crouchAtSuspicion, hide, useAbilities, fleeSprint,
// accuse ('deduce' | 'guess' | 'none'), clueOrder ('nearest' | 'shuffle'), startDelayMaxS (patrol phase), skipClues
// (partial-success episodes), decisionHz, maxTimeS. `runOptions` (4th arg) may override map / caseDef / tuning /
// registries. Cost ≈ 0.2–0.4 s per episode in Node. This module never imports the answer keys (the app loads the Bot
// for its test autopilot): the accusation is deduced from what the found clues say.
//
// Profiles (defaults; every knob can be overridden):
//   stealthy — walks, crouches when the Hyde is within 14 m or suspicious, ducks out of its sight line, hides from
//              investigations, sprints only to flee a chase.
//   careless — walks or sprints (sprintProb 0.5), never crouches or hides, still sprints away from a chase.
import type { MysteryRun } from './run.ts';
import { mentionCounts } from './caseLogic.ts';
import { Rng } from './rng.ts';
import { wrapAngle, yawTo } from './geometry.ts';
import type { Accusation, ClueId, MysteryInput, Vec2 } from './types.ts';

export type BotProfile = 'stealthy' | 'careless';

export interface BotOptions {
  profile: BotProfile;
  /** P(sprint) re-drawn every decision window while walking normally. */
  sprintProb?: number;
  /** Crouch when the Hyde is within this distance (0 = never). */
  crouchNearHydeM?: number;
  /** Crouch when the Hyde's suspicion is at least this (2 = never). */
  crouchAtSuspicion?: number;
  /** Run to a hiding spot when the Hyde investigates / chases nearby. */
  hide?: boolean;
  /** Use F / Q when chased (or when the effect obviously helps). */
  useAbilities?: boolean;
  /** Sprint away when chased. */
  fleeSprint?: boolean;
  /** Give up after this many active seconds (episode marked timedOut). */
  maxTimeS?: number;
  /** Accusation policy: the culprit when all clues are found (else a seeded guess), or always a seeded guess. */
  accuse?: 'deduce' | 'guess' | 'none';
  /** Order the clues by nearest-neighbour tour (default) or a seeded shuffle. */
  clueOrder?: 'nearest' | 'shuffle';
  /** Bot decisions per second (inputs are held between decisions). */
  decisionHz?: number;
  /** Skip clue collection (go straight for the egg) — partial-success episodes. */
  skipClues?: boolean;
  /** Idle for a seeded 0..startDelayMaxS seconds before moving (varies the Hyde's patrol phase like real visitors). */
  startDelayMaxS?: number;
}

const PROFILES: Record<BotProfile, Required<Omit<BotOptions, 'profile'>>> = {
  stealthy: {
    sprintProb: 0, crouchNearHydeM: 14, crouchAtSuspicion: 0.15, hide: true, useAbilities: false, fleeSprint: true,
    maxTimeS: 900, accuse: 'deduce', clueOrder: 'nearest', decisionHz: 10, skipClues: false, startDelayMaxS: 20,
  },
  careless: {
    sprintProb: 0.5, crouchNearHydeM: 0, crouchAtSuspicion: 2, hide: false, useAbilities: false, fleeSprint: true,
    maxTimeS: 900, accuse: 'deduce', clueOrder: 'nearest', decisionHz: 10, skipClues: false, startDelayMaxS: 20,
  },
};

export function resolveBotOptions(o: BotOptions): Required<BotOptions> {
  return { ...PROFILES[o.profile], ...stripUndefined(o) } as Required<BotOptions>;
}

type Goal =
  | { kind: 'clue'; id: ClueId; at: Vec2 }
  | { kind: 'egg'; at: Vec2 }
  | { kind: 'tower'; at: Vec2 }
  | { kind: 'hide'; at: Vec2; until: number }
  | { kind: 'flee'; at: Vec2 };

export class Bot {
  readonly o: Required<BotOptions>;
  readonly rng: Rng;
  private path: Vec2[] = [];
  private pathGoal: Vec2 | null = null;
  private pathT = -Infinity;
  private sprinting = false;
  private nextSprintDraw = 0;
  private lastProgress = { x: 0, z: 0, t: 0 };
  private jitterUntil = -Infinity;
  private jitterYaw = 0;
  private hideGoal: Goal | null = null;
  private clueOrder: ClueId[];
  private waitingInteract = false;
  private fleeReplanAt = -Infinity;
  readonly startAt: number;

  constructor(readonly run: MysteryRun, options: BotOptions, seed: string) {
    this.o = resolveBotOptions(options);
    this.rng = new Rng(seed, 'bot');
    this.clueOrder = this.planClues();
    this.startAt = this.o.startDelayMaxS > 0 ? Math.round(this.rng.range(0, this.o.startDelayMaxS) * 10) / 10 : 0;
  }

  private planClues(): ClueId[] {
    const clues = this.run.map.clues.map((c) => ({ id: c.clueId, at: { x: c.x, z: c.z } }));
    if (this.o.clueOrder === 'shuffle') {
      const arr = [...clues];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = this.rng.int(i + 1);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr.map((c) => c.id);
    }
    const out: ClueId[] = [];
    let at: Vec2 = { x: this.run.player.x, z: this.run.player.z };
    const left = [...clues];
    while (left.length) {
      left.sort((a, b) => Math.hypot(a.at.x - at.x, a.at.z - at.z) - Math.hypot(b.at.x - at.x, b.at.z - at.z));
      const next = left.shift()!;
      out.push(next.id);
      at = next.at;
    }
    return out;
  }

  /** The objective goal ignoring threats. */
  private objectiveGoal(): Goal | null {
    const run = this.run;
    const egg = run.egg;
    if (egg.state === 'carried') return { kind: 'tower', at: { x: run.map.tower.x, z: run.map.tower.z } };
    if (egg.state === 'dropped') return { kind: 'egg', at: { x: egg.x, z: egg.z } };
    if (!this.o.skipClues) {
      for (const id of this.clueOrder) {
        if (run.cluesFound.includes(id)) continue;
        const c = run.map.clues.find((cl) => cl.clueId === id)!;
        return { kind: 'clue', id, at: { x: c.x, z: c.z } };
      }
    }
    if (egg.state === 'resting') return { kind: 'egg', at: { x: egg.x, z: egg.z } };
    return null;
  }

  /** Decide this window's input. */
  decide(): MysteryInput {
    const run = this.run;
    const p = run.player;
    const h = run.hyde;
    const t = run.t;
    const o = this.o;
    const input: MysteryInput = {
      moveX: 0, moveZ: 0, lookYawDelta: 0, lookPitchDelta: 0, sprint: false, crouch: false, interact: false, power: false,
      move: false, hint: false, interactHeld: false,
    };
    if (t < this.startAt) return input;
    const dHyde = Math.hypot(h.x - p.x, h.z - p.z);
    const chased = h.mode === 'CHASE';
    const alert = h.mode === 'INVESTIGATE_SOUND' || h.mode === 'SEARCH';

    // ---- abilities (generic: the interpreter decides whether they land)
    if (o.useAbilities && chased && dHyde < 10) {
      if (run.powerStatus().ready) input.power = true;
      else if (run.moveStatus().ready) input.move = true;
    }

    // ---- threat response
    let goal: Goal | null = this.objectiveGoal();
    if (this.hideGoal && this.hideGoal.kind === 'flee' && !chased) {
      // chase over: hide nearby if this bot hides, else resume the objective
      this.hideGoal = null;
      if (o.hide && alert) {
        const spot = this.pickRefuge(false);
        if (spot) this.hideGoal = { kind: 'hide', at: spot, until: t + 8 };
      }
    }
    if (this.hideGoal && (this.hideGoal.kind !== 'hide' || t < this.hideGoal.until) && (chased || alert || this.hideGoal.kind === 'hide')) {
      goal = this.hideGoal;
    } else this.hideGoal = null;
    if (chased && dHyde < 18) {
      // flee: sprint toward a point away from the Hyde and out of its sight line, re-chosen every second
      if (!this.hideGoal || this.hideGoal.kind !== 'flee' || t >= this.fleeReplanAt) {
        const spot = this.pickEvade([8, 14, 20]);
        if (spot) this.hideGoal = { kind: 'flee', at: spot };
        this.fleeReplanAt = t + 1;
      }
      if (this.hideGoal) goal = this.hideGoal;
    } else if (o.hide && !chased && !this.hideGoal && dHyde < 16 && this.hydeLooksAtMe()) {
      // the Hyde is coming my way with a clear view: duck out of its sight line before it sees me
      const spot = this.pickRefuge(false) ?? this.pickEvade([4, 7, 10]);
      if (spot) {
        this.hideGoal = { kind: 'hide', at: spot, until: t + 6 };
        goal = this.hideGoal;
      }
    } else if (o.hide && alert && !this.hideGoal && dHyde < 9 && h.lastKnown && Math.hypot(h.lastKnown.x - p.x, h.lastKnown.z - p.z) < 7) {
      const spot = this.pickRefuge(false);
      if (spot) {
        this.hideGoal = { kind: 'hide', at: spot, until: t + 10 };
        goal = this.hideGoal;
      }
    }
    if (!goal) return input;

    // ---- stance
    const nearHyde = o.crouchNearHydeM > 0 && dHyde < o.crouchNearHydeM && !chased;
    const suspicious = h.suspicion >= o.crouchAtSuspicion && !chased;
    let crouch = nearHyde || suspicious;
    if (t >= this.nextSprintDraw) {
      this.sprinting = this.rng.chance(o.sprintProb);
      this.nextSprintDraw = t + this.rng.range(1.5, 4);
    }
    let sprint = !crouch && this.sprinting;
    if (chased && o.fleeSprint) {
      sprint = true;
      crouch = false;
    }

    // ---- arrival / interaction
    const dGoal = Math.hypot(goal.at.x - p.x, goal.at.z - p.z);
    const R = run.tuning.player.interactRangeM;
    if (goal.kind === 'hide' || goal.kind === 'flee') {
      if (dGoal < 0.6) {
        input.crouch = goal.kind === 'hide';
        if (!chased && !alert) this.hideGoal = null;
        return input;
      }
    } else if (goal.kind === 'tower') {
      const inTower = Math.hypot(p.x - run.map.tower.x, p.z - run.map.tower.z) <= run.map.tower.radius - 0.8;
      if (inTower) {
        input.crouch = crouch;
        if (!run.interaction.active) input.interact = true;
        return input;
      }
    } else if (dGoal <= R - 0.4) {
      input.crouch = crouch;
      if (!run.interaction.active || this.waitingInteract === false) {
        if (!run.interaction.active) input.interact = true;
      }
      this.waitingInteract = true;
      return input;
    }
    this.waitingInteract = false;

    // ---- steering along the nav path
    const next = this.nextWaypoint(goal.at);
    let desired = yawTo(p.x, p.z, next.x, next.z);
    if (t < this.jitterUntil) desired = this.jitterYaw;
    input.lookYawDelta = wrapAngle(desired - p.yaw);
    input.moveZ = 1;
    input.crouch = crouch;
    input.sprint = sprint;
    // stuck check
    if (t - this.lastProgress.t > 2.5) {
      const moved = Math.hypot(p.x - this.lastProgress.x, p.z - this.lastProgress.z);
      if (moved < 0.5 && dGoal > 1) {
        this.path = [];
        this.pathGoal = null;
        this.jitterUntil = t + 0.6;
        this.jitterYaw = this.rng.range(-Math.PI, Math.PI);
      }
      this.lastProgress = { x: p.x, z: p.z, t };
    }
    return input;
  }

  private nextWaypoint(goal: Vec2): Vec2 {
    const run = this.run;
    const p = run.player;
    const stale = run.t - this.pathT > 1.5;
    if (!this.pathGoal || Math.hypot(goal.x - this.pathGoal.x, goal.z - this.pathGoal.z) > 0.5 || this.path.length === 0 || stale) {
      this.path = run.playerNav().findPath(p, goal) ?? [];
      this.pathGoal = { ...goal };
      this.pathT = run.t;
    }
    while (this.path.length > 1 && Math.hypot(this.path[0].x - p.x, this.path[0].z - p.z) < 0.35) this.path.shift();
    return this.path[0] ?? goal;
  }

  /** A nearby walkable point out of the Hyde's sight line and away from it (fallback when no hiding spot fits). */
  private pickEvade(radii: number[]): Vec2 | null {
    const run = this.run;
    const p = run.player;
    const h = run.hyde;
    const nav = run.playerNav();
    let best: Vec2 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      for (const r of radii) {
        const c = nav.nearestWalkable({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }, 1);
        if (!c || !nav.reachable(p, c, 1)) continue;
        const dH = Math.hypot(c.x - h.x, c.z - h.z);
        const hidden = !run.world.lineOfSight(h.x, h.z, c.x, c.z, true);
        const score = dH + (hidden ? 12 : 0) - r * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
    }
    return best;
  }

  /** Visible-to-the-player check: the Hyde faces me (within its cone + margin) and nothing blocks the line. */
  private hydeLooksAtMe(): boolean {
    const run = this.run;
    const p = run.player;
    const h = run.hyde;
    const off = Math.abs(wrapAngle(yawTo(h.x, h.z, p.x, p.z) - h.yaw));
    if (off > ((run.tuning.sight.coneDeg + 30) * Math.PI) / 360) return false;
    return run.world.lineOfSight(h.x, h.z, p.x, p.z, p.crouched);
  }

  /** A hiding spot (or, when fleeing, any safe point) away from the Hyde, preferring ones not behind it. */
  private pickRefuge(fleeing: boolean): Vec2 | null {
    const run = this.run;
    const p = run.player;
    const h = run.hyde;
    const nav = run.playerNav();
    const cands: Vec2[] = run.map.hidingSpots.map((s) => ({ x: s.x, z: s.z }));
    if (fleeing && !this.o.hide) cands.push(...run.map.safeReleasePoints);
    let best: Vec2 | null = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      const dMe = Math.hypot(c.x - p.x, c.z - p.z);
      const dH = Math.hypot(c.x - h.x, c.z - h.z);
      if (dMe > 30 || dH < dMe + 2) continue;
      // reject refuges whose straight line passes close to the Hyde
      const ax = c.x - p.x;
      const az = c.z - p.z;
      const len2 = ax * ax + az * az || 1;
      const tt = Math.max(0, Math.min(1, ((h.x - p.x) * ax + (h.z - p.z) * az) / len2));
      const passD = Math.hypot(p.x + ax * tt - h.x, p.z + az * tt - h.z);
      if (passD < 4) continue;
      if (!nav.reachable(p, c, 2)) continue;
      const score = dH - dMe * 1.2;
      if (score > bestScore) {
        bestScore = score;
        best = nav.nearestWalkable(c, 2) ?? c;
      }
    }
    return best;
  }

  /**
   * The bot's one-shot accusation. 'deduce' (all clues found) names the suspect the found clues mention most — by case
   * design the culprit is named in every clue and each innocent in one — and cites the found clues. It never reads the
   * answer key. 'guess' names a seeded random suspect and cites whatever it found.
   */
  accusation(): Accusation {
    const run = this.run;
    if (this.o.accuse === 'none') return { suspectId: null, evidence: [] };
    const suspects = run.caseDef.suspects.map((s) => s.id);
    const evidence = run.caseDef.clues.filter((c) => run.cluesFound.includes(c.id)).map((c) => c.id);
    if (this.o.accuse === 'deduce' && run.cluesFound.length === run.caseDef.clues.length) {
      const counts = mentionCounts(run.caseDef, run.cluesFound);
      let best = suspects[0]!;
      for (const s of suspects) if (counts[s] > counts[best]) best = s;
      return { suspectId: best, evidence };
    }
    return { suspectId: this.rng.pick(suspects), evidence };
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

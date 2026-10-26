// Scripted autopilot for MysteryRun: plays a whole visit through the nav graph (3 clues → egg → Iago Tower → accuse).
// Used by tests and by the Phase 4 analytics generator for seeded simulated episodes. Every random choice is drawn from
// a seeded stream (`Rng(seed, 'bot')`), and the sim itself is deterministic, so (duo, seed, options) → identical episode.
// The bot reads only what a player can perceive (Hyde position / mode / suspicion meter once it has emerged, its own
// state, the case world's PUBLIC data — areas, candidate sites + priors, examines, the passage lever, hazards — and
// run.investigation()); it never reads the seed draws, run.layout, map.clues or map.eggSpawn on case-world maps.
//
// Investigation policy (case-world maps, docs/overhaul/OVERHAUL_CONTRACT.md):
//   clues   every decision it scores the candidates of the clues still missing: a known clue site (seen / revealed) has
//           p = 1, an unchecked candidate site its group posterior (prior renormalised over the unchecked sites, layout.ts
//           clueSitePosterior); score = p / (distance + 15 m), i.e. "highest prior first, unless another is much
//           nearer". It walks toward the best site until the sim checks it (siteCheckM + line of sight), searches known
//           clues with E, and keeps its current target unless another scores ≥ 1.3× better.
//   egg     after the clues (or with skipClues): the same over the egg sites with the Bayesian posterior (priors × trace
//           likelihoods, checked-empty → 0, layout.ts eggSitePosterior); once the egg is seen it walks to it and picks it up.
//   extras  examines a givesTrace object within 5 m while the egg is still unseen and the Hyde is not close; pulls the
//           passage lever first when lever + the opened passage beats the current route by ≥ 6 m; with `avoidHazards`
//           (stealthy) it waits for a searchlight beam to pass before stepping into its range and crouches across noisy
//           floors while the Hyde is within 22 m.
// Maps without a world (test fixtures) keep the legacy policy (the clue tour over map.clues, then map.eggSpawn).
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
// accuse ('deduce' | 'guess' | 'none'), clueOrder ('nearest' | 'shuffle', legacy maps only), startDelayMaxS (patrol
// phase), skipClues (partial-success episodes), avoidHazards, useExtras, decisionHz, maxTimeS. `runOptions` (4th arg) may
// override map / caseDef / tuning / registries / layout. This module never imports the answer keys (the app loads the
// Bot for its test autopilot): the accusation is deduced from what the found clues say.
//
// Profiles (defaults; every knob can be overridden):
//   stealthy — walks, crouches when the Hyde is within 14 m or suspicious, ducks out of its sight line, hides from
//              investigations, sprints only to flee a chase, respects searchlights / noisy floors.
//   careless — walks or sprints (sprintProb 0.5), never crouches or hides, ignores hazards, still sprints from a chase.
//
// Joseph Crackstone (ENEMY_CONTRACT; only when run.crackstone exists — maps without him play byte-identically): the bot
// reads his runtime ONLY when a player could know it — while he is visible (run.crackstoneVisible()), chasing /
// cursing (public per R4), or through the public telegraphs (scan ring / curse circle + run.scanExposure() /
// run.curseExposure(), R9). Priorities: step out of a curse circle > get covered from a scan (nearest point out of the
// ring or behind a wall within 7 m, else a hiding spot; crouching never helps) > (stealthy) duck out of his gaze when he
// looks its way (at most once per 8 s). During his chase it keeps walking its route (see crackstoneResponse). It never
// crouches during a curse / scan dodge and sprints only when a walk would not get out in time (sprints are loud: the
// Hyde hears them). Abilities against him only in an emergency (a curse about to land on the bot); they are the Hyde's
// counters.
//
// Final (docs/final/FINAL_CONTRACT.md): the Hyde counts as present only while ACTIVE (the encounter director despawns and
// respawns it). Slurp is read only when a player could know it — while visible (run.slurpVisible()) or chasing /
// lunging (public, like Crackstone R4): a chase or lunge → sprint away out of his sight line (he is slower than a sprint);
// a visible Slurp close by (stealthy) → step out of his view. Cabinets (stealthy, `hide`): when a hunter is searching /
// investigating near the bot (and does not see it right now) and a cabinet's door is within 8 m and closer than the
// threat, it walks there, enters (E), closes the door (E), waits until no hunter is close and alert for 2 s (or a
// creak is due, or 20 s passed), then opens the door (E) and walks on. Crouch-in hiding spots exclude cabinets.
import type { MysteryRun } from './run.ts';
import { cabinetDoor } from './cabinet.ts';
import { mentionCounts } from './caseLogic.ts';
import { World, wrapAngle, yawTo } from './geometry.ts';
import { noisyFloorAt, searchlightEtaS, searchlightsOf, type SearchlightHazard } from './hazards.ts';
import { clueSitePosterior, eggSitePosterior } from './layout.ts';
import { navGridFor, pathLength } from './nav.ts';
import { Rng } from './rng.ts';
import type { Accusation, CaseWorldDef, ClueId, InvestigationState, MysteryInput, Vec2 } from './types.ts';

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
  /** Legacy maps (no world): order the clues by nearest-neighbour tour (default) or a seeded shuffle. */
  clueOrder?: 'nearest' | 'shuffle';
  /** Bot decisions per second (inputs are held between decisions). */
  decisionHz?: number;
  /** Skip clue collection (go straight for the egg) — partial-success episodes. */
  skipClues?: boolean;
  /** Idle for a seeded 0..startDelayMaxS seconds before moving (varies the Hyde's patrol phase like real visitors). */
  startDelayMaxS?: number;
  /** Wait for searchlight beams and crouch over noisy floors while the Hyde is near. */
  avoidHazards?: boolean;
  /** Examine nearby trace objects and pull the passage lever when it shortens the route. */
  useExtras?: boolean;
}

const PROFILES: Record<BotProfile, Required<Omit<BotOptions, 'profile'>>> = {
  stealthy: {
    sprintProb: 0, crouchNearHydeM: 14, crouchAtSuspicion: 0.15, hide: true, useAbilities: false, fleeSprint: true,
    maxTimeS: 900, accuse: 'deduce', clueOrder: 'nearest', decisionHz: 10, skipClues: false, startDelayMaxS: 20,
    avoidHazards: true, useExtras: true,
  },
  careless: {
    sprintProb: 0.5, crouchNearHydeM: 0, crouchAtSuspicion: 2, hide: false, useAbilities: false, fleeSprint: true,
    maxTimeS: 900, accuse: 'deduce', clueOrder: 'nearest', decisionHz: 10, skipClues: false, startDelayMaxS: 20,
    avoidHazards: false, useExtras: true,
  },
};

export function resolveBotOptions(o: BotOptions): Required<BotOptions> {
  return { ...PROFILES[o.profile], ...stripUndefined(o) } as Required<BotOptions>;
}

type Goal =
  | { kind: 'clue'; id: ClueId; at: Vec2 }
  | { kind: 'site'; id: string; at: Vec2 } // walk until the sim checks this candidate site
  | { kind: 'egg'; at: Vec2 }
  | { kind: 'tower'; at: Vec2 }
  | { kind: 'lever'; id: string; at: Vec2 }
  | { kind: 'examine'; id: string; at: Vec2 }
  | { kind: 'hide'; at: Vec2; until: number }
  | { kind: 'flee'; at: Vec2 }
  | { kind: 'cabinet'; id: string; at: Vec2; until: number };

/** Distance penalty (m) in the site score p / (d + K). */
const SCORE_K = 15;
/** Switch targets only when another candidate scores this much better. */
const HYSTERESIS = 1.3;

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
  private fleeReplanAt = -Infinity;
  readonly startAt: number;
  // ---- case-world planning state
  private current: { key: string; goal: Goal; score: number } | null = null;
  private readonly visited = new Set<string>();
  private readonly skipped = new Set<string>(); // examines / lever given up on
  private extraGoal: { goal: Goal; since: number } | null = null;
  private readonly leverChecked = new Set<string>(); // goal keys already evaluated for the lever detour
  private beamWaitSince = -Infinity;
  private readonly lights: SearchlightHazard[];
  // ---- Crackstone response state
  private crackGoal: { goal: Goal; why: 'curse' | 'scan' | 'view'; key: number; until: number } | null = null;
  private crackViewReadyAt = -Infinity;
  // ---- Slurp / cabinet state
  private slurpGoal: { goal: Goal; until: number } | null = null;
  private cabinetGoal: { id: string; at: Vec2; until: number } | null = null;
  private calmSince = -Infinity;
  private cabinetReadyAt = -Infinity;
  private enteredCabinetAt = -Infinity;
  private slurpEvadeReadyAt = -Infinity;

  constructor(readonly run: MysteryRun, options: BotOptions, seed: string) {
    this.o = resolveBotOptions(options);
    this.rng = new Rng(seed, 'bot');
    this.clueOrder = run.map.world ? [] : this.planClues();
    this.startAt = this.o.startDelayMaxS > 0 ? Math.round(this.rng.range(0, this.o.startDelayMaxS) * 10) / 10 : 0;
    this.lights = searchlightsOf(run.map.world?.hazards);
  }

  // ------------------------------------------------------------------------------------------------ legacy (no world)

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

  private legacyGoal(): Goal | null {
    const run = this.run;
    if (!this.o.skipClues) {
      for (const id of this.clueOrder) {
        if (run.cluesFound.includes(id)) continue;
        const c = run.map.clues.find((cl) => cl.clueId === id)!;
        return { kind: 'clue', id, at: { x: c.x, z: c.z } };
      }
    }
    if (run.egg.state === 'resting') return { kind: 'egg', at: { x: run.egg.x, z: run.egg.z } };
    return null;
  }

  // ------------------------------------------------------------------------------------------------ case-world planning

  /** Candidate goals (with posterior p) from public knowledge only. */
  private candidates(w: CaseWorldDef, inv: InvestigationState): { key: string; goal: Goal; p: number }[] {
    const run = this.run;
    const out: { key: string; goal: Goal; p: number }[] = [];
    const missing = w.clueSites.filter((g) => !run.cluesFound.includes(g.clueId));
    if (!this.o.skipClues && missing.length > 0) {
      for (const g of missing) {
        const known = inv.knownClueSites[g.clueId];
        if (known) {
          const s = g.sites.find((x) => x.id === known);
          if (s) out.push({ key: `clue:${g.clueId}`, goal: { kind: 'clue', id: g.clueId, at: { x: s.x, z: s.z } }, p: 1 });
          continue;
        }
        const post = clueSitePosterior(w, g.clueId, inv);
        g.sites.forEach((s, i) => {
          if (post[i] > 0 && !this.visited.has(s.id)) out.push({ key: `site:${s.id}`, goal: { kind: 'site', id: s.id, at: { x: s.x, z: s.z } }, p: post[i] });
        });
      }
      if (out.length > 0) return out;
    }
    if (inv.eggSeenAt) {
      const s = w.eggSites.find((x) => x.id === inv.eggSeenAt);
      if (s && run.egg.state === 'resting') out.push({ key: 'egg', goal: { kind: 'egg', at: { x: run.egg.x, z: run.egg.z } }, p: 1 });
      return out;
    }
    const post = eggSitePosterior(w, inv);
    w.eggSites.forEach((s, i) => {
      if (post[i] > 0 && !this.visited.has(s.id)) out.push({ key: `site:${s.id}`, goal: { kind: 'site', id: s.id, at: { x: s.x, z: s.z } }, p: post[i] });
    });
    return out;
  }

  private worldGoal(w: CaseWorldDef): Goal | null {
    const run = this.run;
    const p = run.player;
    const inv = run.investigation();
    // a 'site' goal reached without being checked (should not happen) is skipped from now on
    if (this.current?.goal.kind === 'site' && Math.hypot(this.current.goal.at.x - p.x, this.current.goal.at.z - p.z) < 0.8) {
      this.visited.add(this.current.goal.id);
    }
    const cands = this.candidates(w, inv);
    if (cands.length === 0) {
      this.current = null;
      return null;
    }
    const score = (c: { goal: Goal; p: number }) => c.p / (Math.hypot(c.goal.at.x - p.x, c.goal.at.z - p.z) + SCORE_K);
    let best = cands[0];
    for (const c of cands) if (score(c) > score(best)) best = c;
    const cur = this.current ? cands.find((c) => c.key === this.current!.key) : undefined;
    const chosen = cur && score(best) < score(cur) * HYSTERESIS ? cur : best;
    this.current = { key: chosen.key, goal: chosen.goal, score: score(chosen) };
    return chosen.goal;
  }

  /** Optional detours: the passage lever when it shortens the route, a nearby trace object while the egg is unknown. */
  private extras(w: CaseWorldDef, goal: Goal | null): Goal | null {
    const run = this.run;
    const p = run.player;
    const t = run.t;
    const h = run.hyde;
    const inv = run.investigation();
    const threatened = run.hydeActive && (h.mode !== 'PATROL' || Math.hypot(h.x - p.x, h.z - p.z) < 15);
    if (this.extraGoal) {
      const g = this.extraGoal.goal;
      const done = g.kind === 'lever' ? inv.passageOpen : g.kind === 'examine' ? inv.examined.includes(g.id) : true;
      if (done) this.extraGoal = null;
      else if (t - this.extraGoal.since > 25 || (threatened && g.kind === 'examine')) {
        if (g.kind === 'lever' || g.kind === 'examine') this.skipped.add(g.id);
        this.extraGoal = null;
      } else return g;
    }
    if (!goal || threatened) return null;
    // lever: evaluate once per goal (keyed on the goal itself: a clue / site / egg / the tower leg)
    const pass = w.passage;
    const key = `${goal.kind}@${goal.at.x.toFixed(1)},${goal.at.z.toFixed(1)}`;
    if (pass && !inv.passageOpen && !this.skipped.has(pass.id) && !this.leverChecked.has(key)) {
      this.leverChecked.add(key);
      if (this.leverShortens(pass.wallId, { x: pass.leverX, z: pass.leverZ }, goal.at)) {
        this.extraGoal = { goal: { kind: 'lever', id: pass.id, at: { x: pass.leverX, z: pass.leverZ } }, since: t };
        return this.extraGoal.goal;
      }
    }
    // examine: a trace object within 5 m while the egg is unknown
    if (!inv.eggSeenAt && run.egg.state === 'resting') {
      for (const ex of w.examines) {
        if (!ex.givesTrace || inv.examined.includes(ex.id) || this.skipped.has(ex.id)) continue;
        if (Math.hypot(ex.x - p.x, ex.z - p.z) > 5) continue;
        this.extraGoal = { goal: { kind: 'examine', id: ex.id, at: { x: ex.x, z: ex.z } }, since: t };
        return this.extraGoal.goal;
      }
    }
    return null;
  }

  /** Lever → opened passage → goal beats the current route to the goal by ≥ 6 m (+ the time spent pulling). */
  private leverShortens(wallId: string, lever: Vec2, goal: Vec2): boolean {
    const run = this.run;
    const T = run.tuning;
    const nav = run.playerNav();
    const direct = nav.findPath(run.player, goal);
    if (!direct || direct.length === 0) return false;
    const openWorld = new World(run.map, T.nav.lowCoverBlocksMovement);
    for (const wl of run.world.walls) if (run.isWallOpen(wl.id)) openWorld.setWallOpen(wl.id, true);
    openWorld.setWallOpen(wallId, true);
    const openNav = navGridFor(run.map, openWorld, T.player.radius, T.nav.cellM, T.nav.lowCoverBlocksMovement);
    const toLever = nav.findPath(run.player, lever);
    const after = openNav.findPath(lever, goal);
    if (!toLever || !after || after.length === 0) return false;
    const pullCostM = T.player.leverS * T.player.walkSpeed;
    return pathLength(run.player, toLever) + pathLength(lever, after) + pullCostM < pathLength(run.player, direct) - 6;
  }

  /** The objective goal ignoring threats (extras — lever / examine detours — apply to every leg, egg carry included). */
  private objectiveGoal(): Goal | null {
    const run = this.run;
    const egg = run.egg;
    const w = run.map.world;
    let goal: Goal | null;
    if (egg.state === 'carried') goal = { kind: 'tower', at: { x: run.map.tower.x, z: run.map.tower.z } };
    else if (egg.state === 'dropped') goal = { kind: 'egg', at: { x: egg.x, z: egg.z } };
    else if (!w) return this.legacyGoal();
    else goal = this.worldGoal(w);
    return w && this.o.useExtras ? (this.extras(w, goal) ?? goal) : goal;
  }

  // ------------------------------------------------------------------------------------------------ decisions

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
    if (p.cabinet) return this.insideCabinet(input);
    const emerged = run.hydeActive;
    const dHyde = emerged ? Math.hypot(h.x - p.x, h.z - p.z) : Infinity;
    const chased = emerged && h.mode === 'CHASE';
    const alert = emerged && (h.mode === 'INVESTIGATE_SOUND' || h.mode === 'SEARCH');

    // ---- abilities (generic: the interpreter decides whether they land)
    if (o.useAbilities && chased && dHyde < 10) {
      if (run.powerStatus().ready) input.power = true;
      else if (run.moveStatus().ready) input.move = true;
    }
    const cs = run.crackstone;
    if (cs && o.useAbilities && !chased && !input.power && !input.move) {
      // against Crackstone only in an emergency (a curse about to land on me): the powers are the Hyde counters
      if (cs.curse && cs.curse.landsAt - t < 0.5 && run.curseExposure() === 'exposed') {
        if (run.powerStatus().ready) input.power = true;
        else if (run.moveStatus().ready) input.move = true;
      }
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
    } else if (o.hide && emerged && !chased && !this.hideGoal && dHyde < 16 && this.hydeLooksAtMe()) {
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
    // ---- Joseph Crackstone (public information only)
    const crack = cs ? this.crackstoneResponse(chased) : null;
    if (crack) goal = crack;
    // ---- Slurp (public information only)
    const slurpFlee = this.slurpResponse();
    if (slurpFlee) goal = slurpFlee;
    // ---- cabinets: a hunter searching nearby (not seeing me) and a cabinet close at hand
    const cab = !slurpFlee && !chased ? this.cabinetChoice(alert, dHyde) : null;
    if (cab) goal = cab;
    if (!goal) return input;

    // ---- stance
    const nearHyde = o.crouchNearHydeM > 0 && dHyde < o.crouchNearHydeM && !chased;
    const suspicious = emerged && h.suspicion >= o.crouchAtSuspicion && !chased;
    let crouch = nearHyde || suspicious;
    if (o.avoidHazards && emerged && !chased && dHyde < 22 && noisyFloorAt(run.map.world?.hazards, p.x, p.z)) crouch = true;
    if (t >= this.nextSprintDraw) {
      this.sprinting = this.rng.chance(o.sprintProb);
      this.nextSprintDraw = t + this.rng.range(1.5, 4);
    }
    let sprint = !crouch && this.sprinting;
    const slurpHunting = !!run.slurp && run.slurp.active && (run.slurp.mode === 'CHASE' || run.slurp.mode === 'ATTACK');
    if ((chased || (slurpFlee && slurpHunting)) && o.fleeSprint) {
      sprint = true;
      crouch = false;
    }
    if (goal.kind === 'cabinet') {
      sprint = false; // a slam would be heard
      crouch = false;
    }
    if (crack && this.crackGoal && this.crackGoal.why !== 'view') {
      // a curse / scan / his chase: crouching never helps against him; sprint (loud: the Hyde hears it) only when a
      // walk would not get out in time
      crouch = false;
      const g = this.crackGoal;
      const need = Math.hypot(g.goal.at.x - p.x, g.goal.at.z - p.z);
      const left = Math.max(0, g.until - 0.3 - t);
      sprint = need > left * run.tuning.player.walkSpeed * 0.8;
    }

    // ---- arrival / interaction
    const dGoal = Math.hypot(goal.at.x - p.x, goal.at.z - p.z);
    const R = run.tuning.player.interactRangeM;
    if (goal.kind === 'cabinet') {
      const it = run.interactable();
      if (it?.kind === 'cabinet' && it.id === goal.id) {
        input.interact = true;
        this.cabinetGoal = null;
        this.calmSince = -Infinity;
        this.enteredCabinetAt = t;
        return input;
      }
    } else if (goal.kind === 'hide' || goal.kind === 'flee') {
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
    } else if (goal.kind !== 'site' && dGoal <= R - 0.4) {
      input.crouch = crouch;
      if (!run.interaction.active) input.interact = true;
      return input;
    }

    // ---- steering along the nav path
    const next = this.nextWaypoint(goal.at);
    let desired = yawTo(p.x, p.z, next.x, next.z);
    if (t < this.jitterUntil) desired = this.jitterYaw;
    input.lookYawDelta = wrapAngle(desired - p.yaw);
    input.moveZ = 1;
    input.crouch = crouch;
    input.sprint = sprint;
    // searchlights: wait (crouched, out of range) for the beam to pass before stepping into it
    if (o.avoidHazards && emerged && !chased && this.beamAhead(next)) {
      if (this.beamWaitSince === -Infinity) this.beamWaitSince = t;
      if (t - this.beamWaitSince < 4) {
        input.moveZ = 0;
        input.sprint = false;
        input.crouch = true;
        this.lastProgress = { x: p.x, z: p.z, t };
        return input;
      }
    } else this.beamWaitSince = -Infinity;
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

  /**
   * Crackstone response goal (or null): curse circle -> step out; scan warning -> get covered; his gaze (stealthy) ->
   * duck out of his sight line. Reads his runtime only when a player could know it.
   */
  private crackstoneResponse(hydeChasing: boolean): Goal | null {
    const run = this.run;
    const c = run.crackstone;
    const brain = run.crackstoneBrain;
    if (!c || !brain || !brain.active) {
      this.crackGoal = null;
      return null;
    }
    const t = run.t;
    const cur = this.crackGoal;
    // 1. a curse circle on me: step out of it (away from its centre / from him)
    if (c.curse && run.curseExposure() !== 'out') {
      if (cur?.why === 'curse' && cur.key === c.curse.startedAt) return cur.goal;
      const at = this.outOfCircle(c.curse, c);
      if (at) {
        this.crackGoal = { goal: { kind: 'flee', at }, why: 'curse', key: c.curse.startedAt, until: c.curse.landsAt + 0.2 };
        return this.crackGoal.goal;
      }
    }
    // 2. a scan warning that would hit me: nearest cover (out of the ring, behind a wall, or a hiding spot)
    if (c.scan?.phase === 'warning') {
      if (cur?.why === 'scan' && cur.key === c.scan.startedAt) return cur.goal;
      if (run.scanExposure() === 'exposed') {
        const g = this.scanCover(c, c.scan.radiusM);
        if (g) {
          this.crackGoal = { goal: g, why: 'scan', key: c.scan.startedAt, until: c.scan.pulseAt + 0.3 };
          return g;
        }
      }
    }
    if (cur && (cur.why === 'curse' || cur.why === 'scan') && t < cur.until) return cur.goal;
    // 3. he chases me (public): the bot keeps walking its route — a moving player leaves every curse circle, and the
    //    leash ends the chase. Fleeing / breaking sight was measured (126 duos × 3 cases) and doubled his chases, cost
    //    30–60 s and drew the Hyde with sprint noise, so it is deliberately not done.
    // 4. stealthy: he is visible and looks my way -> duck out of his sight line for a moment
    if (this.o.hide && !hydeChasing && run.crackstoneVisible() && c.mode !== 'CHASE' && c.mode !== 'ATTACK') {
      if (cur?.why === 'view' && t < cur.until) return cur.goal;
      if (t >= this.crackViewReadyAt && this.crackLooksAtMe(c, brain.cfg.sight.coneDeg, brain.cfg.sight.rangeM)) {
        const at = this.crackEvade(c, brain.centroid, [3, 6, 9]);
        this.crackViewReadyAt = t + 8; // at most one duck per 8 s, so objectives inside his area stay reachable
        if (at) {
          this.crackGoal = { goal: { kind: 'hide', at, until: t + 3 }, why: 'view', key: 0, until: t + 3 };
          return this.crackGoal.goal;
        }
      }
    }
    this.crackGoal = null;
    return null;
  }

  /** He faces me (cone + margin), I am within his sight range + 3 m and nothing blocks the line. */
  private crackLooksAtMe(c: { x: number; z: number; yaw: number }, coneDeg: number, rangeM: number): boolean {
    const run = this.run;
    const p = run.player;
    if (Math.hypot(c.x - p.x, c.z - p.z) > rangeM + 3) return false;
    const off = Math.abs(wrapAngle(yawTo(c.x, c.z, p.x, p.z) - c.yaw));
    if (off > ((coneDeg + 30) * Math.PI) / 360) return false;
    return run.world.lineOfSight(c.x, c.z, p.x, p.z, p.crouched);
  }

  /** A walkable point just outside a curse circle, away from its centre (and from him when standing on the centre). */
  private outOfCircle(curse: { x: number; z: number; radiusM: number }, from: Vec2): Vec2 | null {
    const run = this.run;
    const p = run.player;
    const nav = run.playerNav();
    let dx = p.x - curse.x;
    let dz = p.z - curse.z;
    if (Math.hypot(dx, dz) < 0.3) {
      dx = p.x - from.x;
      dz = p.z - from.z;
    }
    const base = Math.atan2(dz, dx);
    for (const off of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
      const a = base + off;
      const r = curse.radiusM + 1.2;
      const q = nav.nearestWalkable({ x: curse.x + Math.cos(a) * r, z: curse.z + Math.sin(a) * r }, 0.8);
      if (q && Math.hypot(q.x - curse.x, q.z - curse.z) > curse.radiusM + 0.4 && nav.lineWalkable(p, q)) return q;
    }
    return null;
  }

  /** Nearest point (<= 7 m, straight walkable) out of the scan ring or out of his line of sight; else a hiding spot <= 9 m. */
  private scanCover(c: { x: number; z: number }, radiusM: number): Goal | null {
    const run = this.run;
    const p = run.player;
    const nav = run.playerNav();
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const r of [1.5, 2.5, 3.5, 5, 7]) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const q = nav.nearestWalkable({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }, 0.6);
        if (!q) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d >= bestD || !nav.lineWalkable(p, q)) continue;
        const safe = Math.hypot(q.x - c.x, q.z - c.z) > radiusM + 0.8 || !run.world.lineOfSight(c.x, c.z, q.x, q.z, false);
        if (!safe) continue;
        best = q;
        bestD = d;
      }
      if (best) break;
    }
    if (best) return { kind: 'flee', at: best };
    let spot: Vec2 | null = null;
    let spotD = 9;
    for (const s of run.map.hidingSpots) {
      if (s.kind === 'cabinet') continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < spotD && nav.reachable(p, s, 1.5)) {
        spot = nav.nearestWalkable(s, 1) ?? { x: s.x, z: s.z };
        spotD = d;
      }
    }
    if (spot) return { kind: 'hide', at: spot, until: run.t + 3 };
    // nothing near: run straight away from him
    const away = this.crackEvade(c, c, [radiusM + 2]);
    return away ? { kind: 'flee', at: away } : null;
  }

  /** A nearby reachable point away from him and out of his sight line, preferring points beyond his leash. */
  private crackEvade(c: { x: number; z: number }, centroid: Vec2, radii: number[]): Vec2 | null {
    const run = this.run;
    const p = run.player;
    const nav = run.playerNav();
    const leash = run.crackstoneDef?.leashM ?? 0;
    let best: Vec2 | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      for (const r of radii) {
        const q = nav.nearestWalkable({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }, 1);
        if (!q || !nav.reachable(p, q, 1)) continue;
        const dC = Math.hypot(q.x - c.x, q.z - c.z);
        const hidden = !run.world.lineOfSight(c.x, c.z, q.x, q.z, false);
        const outside = Math.hypot(q.x - centroid.x, q.z - centroid.z) > leash;
        const score = dC + (hidden ? 10 : 0) + (outside ? 6 : 0) - r * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = q;
        }
      }
    }
    return best;
  }

  /** About to step into a searchlight's range (≤ 1.5 m ahead) while its beam reaches that point within 1.2 s? */
  private beamAhead(next: Vec2): boolean {
    if (this.lights.length === 0) return false;
    const run = this.run;
    const p = run.player;
    const dx = next.x - p.x;
    const dz = next.z - p.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return false;
    const look = { x: p.x + (dx / l) * Math.min(1.5, l), z: p.z + (dz / l) * Math.min(1.5, l) };
    for (const h of this.lights) {
      if (Math.hypot(p.x - h.x, p.z - h.z) <= h.rangeM) continue; // already inside: keep going
      if (Math.hypot(look.x - h.x, look.z - h.z) > h.rangeM) continue;
      if (!run.world.lineOfSight(h.x, h.z, look.x, look.z, false)) continue;
      if (searchlightEtaS(h, run.t, look.x, look.z) < 1.2) return true;
    }
    return false;
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

  /** A nearby walkable point out of the threat's (default: the Hyde's) sight line and away from it. */
  private pickEvade(radii: number[], threat?: Vec2): Vec2 | null {
    const run = this.run;
    const p = run.player;
    const h = threat ?? run.hyde;
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
    const cands: Vec2[] = run.map.hidingSpots.filter((s) => s.kind !== 'cabinet').map((s) => ({ x: s.x, z: s.z }));
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

  // ------------------------------------------------------------------------------------------------ Slurp + cabinets

  /** Slurp chasing / lunging (public) → sprint out of his sight line; visible and close (stealthy) → step out of view. */
  private slurpResponse(): Goal | null {
    const run = this.run;
    const sl = run.slurp;
    if (!sl || !sl.active) {
      this.slurpGoal = null;
      return null;
    }
    const p = run.player;
    const t = run.t;
    const hunting = sl.mode === 'CHASE' || sl.mode === 'ATTACK';
    const visible = run.slurpVisible();
    const d = Math.hypot(sl.x - p.x, sl.z - p.z);
    if (this.slurpGoal && t < this.slurpGoal.until && (hunting || visible)) return this.slurpGoal.goal;
    this.slurpGoal = null;
    if (hunting && d < 16) {
      const at = this.pickEvade([6, 10, 14], sl);
      if (at) this.slurpGoal = { goal: { kind: 'flee', at }, until: t + 1 };
    } else if (this.o.hide && visible && d < 9 && sl.mode !== 'LEAVE' && t >= this.slurpEvadeReadyAt) {
      // step out of his view, at most once per 8 s (so a route past him stays possible)
      this.slurpEvadeReadyAt = t + 8;
      const at = this.pickEvade([4, 7], sl);
      if (at) this.slurpGoal = { goal: { kind: 'hide', at, until: t + 2.5 }, until: t + 2.5 };
    }
    return this.slurpGoal?.goal ?? null;
  }

  /** A cabinet worth using right now (stealthy only): a hunter alert nearby that does not see me, a door within 8 m. */
  private cabinetChoice(hydeAlert: boolean, dHyde: number): Goal | null {
    const run = this.run;
    const p = run.player;
    const t = run.t;
    if (!this.o.hide) return null;
    if (this.cabinetGoal && t < this.cabinetGoal.until) return { kind: 'cabinet', ...this.cabinetGoal };
    this.cabinetGoal = null;
    if (t < this.cabinetReadyAt || run.egg.state === 'carried') return null;
    const h = run.hyde;
    const hydeNear = hydeAlert && dHyde < 14 && !h.canSeePlayer && !!h.lastKnown && Math.hypot(h.lastKnown.x - p.x, h.lastKnown.z - p.z) < 9;
    const sl = run.slurp;
    const slurpNear = !!sl && sl.active && run.slurpVisible() && (sl.mode === 'INVESTIGATE' || sl.mode === 'SEARCH') && !sl.canSeePlayer
      && Math.hypot(sl.x - p.x, sl.z - p.z) < 12;
    if (!hydeNear && !slurpNear) return null;
    const threat = hydeNear ? { x: h.x, z: h.z } : { x: sl!.x, z: sl!.z };
    const nav = run.playerNav();
    let best: { id: string; at: Vec2; d: number } | null = null;
    for (const s of run.map.hidingSpots) {
      if (s.kind !== 'cabinet') continue;
      const door = cabinetDoor(s);
      const d = Math.hypot(door.x - p.x, door.z - p.z);
      if (d > 8 || Math.hypot(door.x - threat.x, door.z - threat.z) < d + 1) continue;
      if (best && d >= best.d) continue;
      const at = nav.nearestWalkable(door, 1.5);
      if (!at || !nav.reachable(p, at, 1)) continue;
      best = { id: s.id, at, d };
    }
    if (!best) return null;
    this.cabinetGoal = { id: best.id, at: best.at, until: t + 6 };
    this.cabinetReadyAt = t + 20;
    return { kind: 'cabinet', ...this.cabinetGoal };
  }

  /** Inside a cabinet: close the door, wait for calm (or a due creak), then open and step out. */
  private insideCabinet(input: MysteryInput): MysteryInput {
    const run = this.run;
    const t = run.t;
    const st = run.cabinetStatus();
    const cab = run.player.cabinet;
    if (!cab || !st || cab.phase === 'entering' || cab.phase === 'exiting' || st.closing) return input;
    const p = run.player;
    const h = run.hyde;
    const hydeClose = run.hydeActive && h.mode !== 'PATROL' && Math.hypot(h.x - p.x, h.z - p.z) < 14;
    const sl = run.slurp;
    const slurpClose = !!sl && sl.active && sl.mode !== 'WANDER' && sl.mode !== 'LEAVE' && Math.hypot(sl.x - p.x, sl.z - p.z) < 12;
    const threat = hydeClose || slurpClose;
    if (!threat) {
      if (this.calmSince === -Infinity) this.calmSince = t;
    } else this.calmSince = -Infinity;
    const leave = (this.calmSince > -Infinity && t - this.calmSince >= 2) || (st.creakInS !== null && st.creakInS <= 1)
      || st.witnessedBy !== null || t - this.enteredCabinetAt > 20;
    if (cab.phase === 'open') {
      if (leave && !threat) {
        input.moveZ = 1;
        return input;
      }
      input.interact = true; // close the door
      return input;
    }
    if (leave) input.interact = true; // open and step out
    return input;
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

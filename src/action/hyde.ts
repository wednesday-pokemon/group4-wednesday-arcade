// The Hyde: a real pursuer with position and velocity that follows the boat's breadcrumb wake (GDD 5.1). Because
// he only ever moves along the path the boat actually took, he never cuts across land and can never appear ahead of
// the boat; his gap is the path distance along the wake. Phases (types.ts HydePhase):
//   dormant → stalking (underwater shadow) → emerging (~1.5 s) → chasing ⇄ surging (telegraphed) → lunging (a short
//   snap at the stern that can miss: HYDE.lungeMaxS, then HYDE.lungeCooldownS before the next)
//   → [catch → rescue window, handled by the run] → stunned → chasing;  distracted (decoy) and slowed from abilities;
//   retreating near the safe harbour / after the finish.
import { HYDE } from './config.ts';
import type { HydeStageTuning } from './data/stages.ts';
import type { ActionEvent, HydePhase, HydeState, Vec2 } from './types.ts';

// ------------------------------------------------------------------------------------------------- wake trail

/** Breadcrumbs of the boat's path with cumulative arc length. The boat itself is the virtual last point. */
export class WakeTrail {
  private xs: number[] = [];
  private zs: number[] = [];
  private ss: number[] = [];
  private first = 0; // index of the oldest kept breadcrumb (pruned lazily)
  private bx = 0;
  private bz = 0;

  constructor(x: number, z: number, heading: number, seedBehindU = HYDE.trailSeedBehindU, private readonly sampleU = HYDE.trailSampleU) {
    // Seed straight back from the start (behind the boat) so the Hyde always has wake to stand on.
    const bx = Math.sin(heading); // backward = −forward = (sin h, cos h)
    const bz = Math.cos(heading);
    const n = Math.max(1, Math.ceil(seedBehindU / sampleU));
    for (let i = n; i >= 1; i--) {
      const d = (seedBehindU * i) / n;
      this.push(x + bx * d, z + bz * d, seedBehindU - d);
    }
    this.push(x, z, seedBehindU);
    this.bx = x;
    this.bz = z;
  }

  private push(x: number, z: number, s: number): void {
    this.xs.push(x);
    this.zs.push(z);
    this.ss.push(s);
  }

  private get last(): number {
    return this.ss.length - 1;
  }

  /** Arc length at the boat (the head of the wake). */
  get headS(): number {
    const i = this.last;
    return this.ss[i] + Math.hypot(this.bx - this.xs[i], this.bz - this.zs[i]);
  }

  get tailS(): number {
    return this.ss[this.first];
  }

  /** Call every physics step with the boat's position. */
  record(x: number, z: number): void {
    this.bx = x;
    this.bz = z;
    const i = this.last;
    const d = Math.hypot(x - this.xs[i], z - this.zs[i]);
    if (d >= this.sampleU) this.push(x, z, this.ss[i] + d);
  }

  /** Drop breadcrumbs far behind `s` (amortised compaction keeps memory bounded on long runs). */
  prune(s: number): void {
    while (this.first < this.last - 1 && this.ss[this.first + 1] < s) this.first++;
    if (this.first > 2048) {
      this.xs = this.xs.slice(this.first);
      this.zs = this.zs.slice(this.first);
      this.ss = this.ss.slice(this.first);
      this.first = 0;
    }
  }

  /** Position and heading (direction of travel) at arc length s, clamped to the kept wake. */
  pointAt(s: number): { x: number; z: number; heading: number } {
    const head = this.headS;
    const i = this.last;
    if (s >= this.ss[i]) {
      // between the last breadcrumb and the boat
      const seg = head - this.ss[i];
      const u = seg > 1e-9 ? Math.min(1, (s - this.ss[i]) / seg) : 1;
      const dx = this.bx - this.xs[i];
      const dz = this.bz - this.zs[i];
      const h = seg > 1e-6 ? Math.atan2(-dx, -dz) : this.segmentHeading(Math.max(this.first, i - 1));
      return { x: this.xs[i] + dx * u, z: this.zs[i] + dz * u, heading: h };
    }
    let lo = this.first;
    let hi = i;
    if (s <= this.ss[lo]) return { x: this.xs[lo], z: this.zs[lo], heading: this.segmentHeading(lo) };
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.ss[mid] <= s) lo = mid;
      else hi = mid;
    }
    const u = (s - this.ss[lo]) / (this.ss[hi] - this.ss[lo]);
    return {
      x: this.xs[lo] + (this.xs[hi] - this.xs[lo]) * u,
      z: this.zs[lo] + (this.zs[hi] - this.zs[lo]) * u,
      heading: this.segmentHeading(lo),
    };
  }

  private segmentHeading(i: number): number {
    const j = Math.min(i + 1, this.last);
    const k = j === i ? i - 1 : i;
    const dx = this.xs[j] - this.xs[k];
    const dz = this.zs[j] - this.zs[k];
    return Math.atan2(-dx, -dz);
  }
}

// ------------------------------------------------------------------------------------------------- the Hyde

/** Per-step modifiers from abilities, passives, traits and mercy rules (computed by the run). */
export interface HydeModifiers {
  speedMult: number; // product of passives (fog, curse, roots); slows/distractions are tracked by the Hyde itself
  surgeBoostMult: number; // Misdreavus passive, last-chance mercy
  catchRadiusMult: number; // Dusknoir passive
  floorPenalty: number; // last-chance mercy (u/s off the floor speed)
  maxClosingRel: number; // closing cap outside surges
  canCatch: boolean; // false during invulnerability, docking, safe harbour …
}

export const NEUTRAL_HYDE_MODS: HydeModifiers = { speedMult: 1, surgeBoostMult: 1, catchRadiusMult: 1, floorPenalty: 0, maxClosingRel: Infinity, canCatch: true };

interface PendingSurge { requestedAt: number; boost: number; durationS: number }

export interface HydeOptions {
  tuning: HydeStageTuning;
  telegraphBonusS?: number; // Wednesday: surges warned earlier
  spawn?: { x: number; z: number; heading: number }; // where he lies dormant (hidden)
}

export class HydeAI {
  readonly state: HydeState;
  readonly tuning: HydeStageTuning;
  readonly telegraphS: number;
  /** Arc length of the Hyde along the wake. */
  s = 0;
  /** Exponential moving average of the boat's speed (τ = paceAvgTauS). */
  vAvg = 0;
  surgesStarted = 0;
  surgesSkipped = 0;
  private pending: PendingSurge[] = [];
  private surge: { telegraphLeft: number; left: number; boost: number } | null = null;
  private lastSurgeEndAt = -Infinity;
  private lungeReadyAt = -Infinity; // after a missed lunge (HYDE.lungeCooldownS)
  /** Lunges that ran their full HYDE.lungeMaxS without a catch. */
  lungesMissed = 0;
  private holdGap = 0;
  private stunUntil = 0;
  private slowMult = 1;
  private distractMult = 1;
  private warnLevel: 0 | 1 | 2 = 0;
  private lastGap = Infinity;
  private retreatVisibility = 1;

  constructor(private readonly trail: WakeTrail, o: HydeOptions) {
    this.tuning = o.tuning;
    this.telegraphS = o.tuning.surgeTelegraphS + (o.telegraphBonusS ?? 0);
    const spawn = o.spawn ?? trail.pointAt(trail.tailS);
    this.s = trail.tailS;
    this.state = {
      phase: 'dormant', phaseT: 0, x: spawn.x, z: spawn.z, heading: spawn.heading, speed: 0,
      distance: trail.headS - trail.tailS, visibility: 0, threat: 0, slowedUntil: 0, distractedUntil: 0, decoy: null,
    };
  }

  get gap(): number {
    return this.trail.headS - this.s;
  }

  get active(): boolean {
    const p = this.state.phase;
    return p !== 'dormant' && p !== 'retreating';
  }

  /** True while a surge is being telegraphed (the burst has not started yet). */
  get telegraphing(): boolean {
    return !!this.surge && this.surge.telegraphLeft > 0;
  }

  get telegraphLeftS(): number {
    return this.surge ? Math.max(0, this.surge.telegraphLeft) : 0;
  }

  get surgeBursting(): boolean {
    return !!this.surge && this.surge.telegraphLeft <= 0;
  }

  /** Chasing in any form (the phases where abilities that target him make sense). */
  get hunting(): boolean {
    const p = this.state.phase;
    return p === 'chasing' || p === 'surging' || p === 'lunging' || p === 'distracted' || p === 'stunned';
  }

  private setPhase(phase: HydePhase, t: number, events: ActionEvent[], force = false): void {
    if (this.state.phase === phase && !force) return;
    this.state.phase = phase;
    this.state.phaseT = 0;
    events.push({ type: 'hyde_phase', phase, t });
  }

  // ---------------------------------------------------------------- commands (from encounters / abilities / run)

  /** dormant → stalking: placed on the wake `gapU` behind the boat (never ahead, never on land). */
  wake(gapU: number, t: number, events: ActionEvent[]): void {
    if (this.state.phase !== 'dormant') return;
    this.s = Math.max(this.trail.tailS, this.trail.headS - gapU);
    this.holdGap = this.gap;
    this.setPhase('stalking', t, events);
    this.place();
  }

  /** stalking → emerging (→ chasing after HYDE.emergeS). */
  emerge(gapU: number, t: number, events: ActionEvent[]): void {
    if (this.state.phase === 'dormant') this.wake(gapU, t, events);
    if (this.state.phase !== 'stalking') return;
    this.holdGap = this.gap;
    this.setPhase('emerging', t, events);
  }

  requestSurge(t: number, boost = this.tuning.surgeBoost, durationS = this.tuning.surgeDurationS): void {
    this.pending.push({ requestedAt: t, boost, durationS });
  }

  /** Pursuit slow: v × mult until `until`, also during surges (the surge timer keeps running). */
  slow(mult: number, until: number): void {
    this.slowMult = mult;
    this.state.slowedUntil = Math.max(this.state.slowedUntil, until);
  }

  /** Distraction: he chases a lure at v × mult; cancels an active surge (telegraph included). */
  distract(mult: number, until: number, decoy: Vec2, t: number, events: ActionEvent[]): void {
    if (!this.hunting) return;
    if (this.surge) {
      this.surge = null;
      this.lastSurgeEndAt = t;
    }
    this.distractMult = mult;
    this.state.distractedUntil = Math.max(this.state.distractedUntil, until);
    this.state.decoy = decoy;
    this.setPhase('distracted', t, events);
  }

  stun(seconds: number, t: number, events: ActionEvent[]): void {
    if (!this.hunting) return;
    this.stunUntil = Math.max(this.stunUntil, t + seconds);
    this.surge = null;
    this.setPhase('stunned', t, events);
  }

  /** After a catch: placed `gapU` behind the boat along the wake and stunned. */
  knockBack(gapU: number, stunS: number, t: number, events: ActionEvent[]): void {
    this.s = Math.max(this.trail.tailS, this.trail.headS - gapU);
    this.surge = null;
    this.stunUntil = t + stunS;
    this.setPhase('stunned', t, events, true);
    this.place();
  }

  /** Shoves him further back along the wake without changing his phase. */
  pushBack(u: number): void {
    this.s = Math.max(this.trail.tailS, this.s - u);
    this.place();
  }

  /** While the rescue window is open he holds onto the stern. */
  holdBoat(boatSpeed: number): void {
    this.s = Math.max(this.trail.tailS, this.trail.headS - this.tuning.catchRadiusU * 0.6);
    this.state.speed = boatSpeed;
    this.place();
  }

  retreat(t: number, events: ActionEvent[]): void {
    if (this.state.phase === 'retreating') return;
    this.surge = null;
    this.pending = [];
    this.setPhase('retreating', t, events);
  }

  // ---------------------------------------------------------------- simulation

  /**
   * One fixed step. `boatSpeed` is the boat's forward speed. Returns true if he catches the boat this step (the run
   * then opens the rescue window). Emits hyde_phase / hyde_warning events.
   */
  update(dt: number, t: number, boatSpeed: number, mods: HydeModifiers, events: ActionEvent[]): boolean {
    const st = this.state;
    const k = this.tuning;
    st.phaseT += dt;
    this.vAvg += (boatSpeed - this.vAvg) * (1 - Math.exp(-dt / k.paceAvgTauS));
    if (t >= st.slowedUntil) this.slowMult = 1;

    // pending surges: dropped if not started within surgeDeferMaxS
    this.pending = this.pending.filter((p) => {
      const keep = t - p.requestedAt <= k.surgeDeferMaxS;
      if (!keep) this.surgesSkipped++;
      return keep;
    });

    let v = 0;
    const gap = this.gap;
    switch (st.phase) {
      case 'dormant':
        st.speed = 0;
        st.visibility = 0;
        st.threat = 0;
        this.s = Math.max(this.s, this.trail.tailS);
        st.distance = Math.max(0, this.gap); // hidden, but always a finite path distance for the HUD
        this.trail.prune(this.s - HYDE.trailKeepBehindU);
        return false;
      case 'stalking':
      case 'emerging':
        v = Math.max(0, boatSpeed + k.rubberK * (gap - this.holdGap));
        if (st.phase === 'emerging' && st.phaseT >= HYDE.emergeS) this.setPhase('chasing', t, events);
        break;
      case 'stunned':
        v = 0;
        if (t >= this.stunUntil) this.setPhase('chasing', t, events);
        break;
      case 'distracted':
        v = this.chaseSpeed(boatSpeed, gap, mods) * this.distractMult;
        if (t >= st.distractedUntil) {
          st.decoy = null;
          this.setPhase('chasing', t, events);
        }
        break;
      case 'retreating':
        v = -HYDE.retreatSpeed;
        break;
      case 'chasing':
      case 'surging':
      case 'lunging':
        v = this.pursue(dt, t, boatSpeed, gap, mods, events);
        break;
    }
    if (st.phase !== 'retreating') {
      v *= mods.speedMult * this.slowMult;
      // leash: he never falls hopelessly far behind or out of sight (except while lured away)
      if (gap > k.leashGapU && st.phase !== 'distracted' && st.phase !== 'stunned') v = Math.max(v, boatSpeed + k.leashRelSpeed);
    }
    st.speed = v;
    this.s += v * dt;
    this.s = Math.max(this.trail.tailS, Math.min(this.s, this.trail.headS));

    const radius = k.catchRadiusU * mods.catchRadiusMult;
    const canGrab = st.phase === 'chasing' || st.phase === 'surging' || st.phase === 'lunging';
    let caught = false;
    if (this.gap <= radius) {
      if (canGrab && mods.canCatch) caught = true;
      else this.s = Math.max(this.trail.tailS, this.trail.headS - radius - 0.01); // hovers just behind
    }
    this.place();
    this.updateThreat(dt, t, events);
    this.trail.prune(this.s - HYDE.trailKeepBehindU);
    return caught;
  }

  /** CHASE formula (GDD 5.1) without surge/lunge terms, before passive multipliers. */
  private chaseSpeed(boatSpeed: number, gap: number, mods: HydeModifiers): number {
    const k = this.tuning;
    let v = Math.max(k.floorSpeed - mods.floorPenalty, k.paceFactor * this.vAvg) + k.rubberK * (gap - k.targetGapU);
    v = Math.max(k.minSpeed, Math.min(k.maxSpeed, v));
    return Math.min(v, boatSpeed + Math.min(k.maxClosingRel, mods.maxClosingRel));
  }

  private pursue(dt: number, t: number, boatSpeed: number, gap: number, mods: HydeModifiers, events: ActionEvent[]): number {
    const k = this.tuning;
    const st = this.state;
    // start a deferred surge once the gap is fair (never inside surgeMinStartGapU)
    if (!this.surge && st.phase === 'chasing' && this.pending.length && gap >= k.surgeMinStartGapU && t - this.lastSurgeEndAt >= HYDE.surgeMinSpacingS) {
      const p = this.pending.shift()!;
      this.surge = { telegraphLeft: this.telegraphS, left: p.durationS, boost: p.boost };
      this.surgesStarted++;
      this.setPhase('surging', t, events);
    }
    let v = this.chaseSpeed(boatSpeed, gap, mods);
    if (this.surge) {
      if (this.surge.telegraphLeft > 0) this.surge.telegraphLeft -= dt;
      else {
        this.surge.left -= dt;
        const burst = Math.min(k.maxSpeed, this.vAvg + this.surge.boost * mods.surgeBoostMult);
        const uncapped = Math.max(k.minSpeed, Math.max(k.floorSpeed - mods.floorPenalty, k.paceFactor * this.vAvg) + k.rubberK * (gap - k.targetGapU));
        v = Math.max(Math.min(k.maxSpeed, uncapped), burst);
        if (gap <= HYDE.surgeHoldGapU) v = Math.min(v, Math.max(this.vAvg, Math.min(k.maxSpeed, uncapped)));
        if (this.surge.left <= 0) {
          this.surge = null;
          this.lastSurgeEndAt = t;
          if (st.phase === 'surging') this.setPhase('chasing', t, events);
        }
      }
    }
    if (st.phase === 'lunging') {
      v = Math.max(v, Math.min(Math.min(k.maxSpeed, this.vAvg + HYDE.lungeMinRel), boatSpeed + Math.min(k.maxClosingRel, mods.maxClosingRel)));
      const missed = st.phaseT >= HYDE.lungeMaxS;
      if (missed) {
        this.lungesMissed++;
        this.lungeReadyAt = t + HYDE.lungeCooldownS;
      }
      if (missed || gap > HYDE.lungeExitU) this.setPhase(this.surge ? 'surging' : 'chasing', t, events);
    } else if (gap <= HYDE.lungeRangeU && !this.telegraphing && t >= this.lungeReadyAt) {
      this.setPhase('lunging', t, events);
    }
    return v;
  }

  private place(): void {
    const p = this.trail.pointAt(this.s);
    const st = this.state;
    st.x = p.x;
    st.z = p.z;
    st.heading = p.heading;
    if (st.decoy && st.phase === 'distracted') st.heading = Math.atan2(-(st.decoy.x - p.x), -(st.decoy.z - p.z));
    st.distance = Math.max(0, this.gap);
  }

  private updateThreat(dt: number, t: number, events: ActionEvent[]): void {
    const st = this.state;
    const gap = Math.max(0, this.gap);
    switch (st.phase) {
      case 'stalking':
        st.visibility = HYDE.stalkVisibility;
        break;
      case 'emerging':
        st.visibility = HYDE.stalkVisibility + (1 - HYDE.stalkVisibility) * Math.min(1, st.phaseT / HYDE.emergeS);
        break;
      case 'retreating':
        this.retreatVisibility = Math.max(0.3, this.retreatVisibility - dt / 3);
        st.visibility = this.retreatVisibility;
        break;
      default:
        st.visibility = 1;
    }
    if (!this.active || st.phase === 'stalking' || st.phase === 'emerging') {
      st.threat = st.phase === 'stalking' || st.phase === 'emerging' ? 0.15 : Math.max(0, st.threat - dt);
      this.lastGap = gap;
      return;
    }
    const closing = dt > 0 && Number.isFinite(this.lastGap) ? (this.lastGap - gap) / dt : 0;
    this.lastGap = gap;
    const radius = this.tuning.catchRadiusU;
    const prox = Math.max(0, Math.min(1, (HYDE.threatRangeU - gap) / (HYDE.threatRangeU - radius)));
    const closingN = Math.max(0, Math.min(1, closing / this.tuning.maxClosingRel));
    const surge = this.surge ? 0.15 : 0;
    const calm = st.phase === 'stunned' || st.phase === 'distracted' ? 0.5 : 1;
    st.threat = Math.max(0, Math.min(1, (prox * 0.8 + closingN * 0.2 * (gap < 50 ? 1 : 0) + surge) * calm));
    // two warning levels with hysteresis
    if (this.warnLevel < 2 && gap < HYDE.warn2GapU) {
      this.warnLevel = 2;
      events.push({ type: 'hyde_warning', level: 2, t });
    } else if (this.warnLevel < 1 && gap < HYDE.warn1GapU) {
      this.warnLevel = 1;
      events.push({ type: 'hyde_warning', level: 1, t });
    }
    if (this.warnLevel === 2 && gap > HYDE.warn2RearmU) this.warnLevel = 1;
    if (this.warnLevel === 1 && gap > HYDE.warn1RearmU) this.warnLevel = 0;
  }
}

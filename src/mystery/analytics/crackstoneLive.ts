// Live glue for Joseph Crackstone (enemy contract): binds the cached rule-based risk tables (crackstoneRisk.ts) to one
// run, feeds the phase tracker from PUBLIC state only (publicState.crackstoneOf — R4 position rule, HUD mode, telegraphs)
// and builds LiveForecasts.crackstone at ≤ 1 Hz. Also keeps the per-frame public facts the WHY messages need (his last
// public pose, the last curse circle, the scan exposure during a warning).
import type { MysteryRun } from '../run.ts';
import type { CrackstoneMode, StampedEvent, Vec2 } from '../types.ts';
import {
  CRACK_HORIZON_S, CRACK_LABEL, CrackstoneRiskModel, CrackstoneTracker, crackstoneRiskModel, type CrackSample, type RiskGeometry,
} from './crackstoneRisk.ts';
import { crackstoneOf, crackstonePose, type CrackstonePublic } from './publicState.ts';
import type { CrackstoneForecast } from './types.ts';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** The run's risk tables (cached per case map + open walls + his tuning), bound to this run's geometry. */
export function crackstoneRiskFor(run: MysteryRun): CrackstoneRiskModel | null {
  const brain = run.crackstoneBrain;
  if (!brain || brain.def.patrol.length < 2) return null; // no loop to forecast from (the sim tolerates it; tables need one)
  const def = brain.def;
  const cfg = brain.cfg;
  const geo: RiskGeometry = {
    world: run.world, inFog: (x, z) => run.inFog(x, z), nav: brain.nav(run), playerNav: run.playerNav(), hidingSpots: run.map.hidingSpots,
    playerSeesM: cfg.playerSeesCrackstoneM,
  };
  const fp = JSON.stringify([cfg, def]); // every input of the tables (radius, polygon, start yaw, all speeds, …)
  const key = `${run.map.id}|${run.caseDef.id}|${def.areaName}|${run.world.openKey()}|${fp}`;
  return crackstoneRiskModel(key, () => new CrackstoneRiskModel(def, cfg, geo)).bind(geo);
}

/** The tracker input at this instant (public facts only). */
export function crackSampleOf(run: MysteryRun, pub: CrackstonePublic): CrackSample {
  const p = run.player;
  return {
    t: run.t, active: pub.active, mode: pub.mode, pose: pub.pose, canSeePlayer: pub.canSeePlayer,
    player: { x: p.x, z: p.z, crouched: p.crouched, hidden: p.hidden }, hydeChasing: run.hyde.mode === 'CHASE',
    perceptionOffS: pub.perceptionOffS, scanWarning: pub.scan && pub.scan.phase === 'warning' ? { pulseAt: pub.scan.pulseAt } : null,
  };
}

/** What the WHY rules may know at the frame of a Crackstone event (computed by CrackstoneLive.frameFacts). */
export interface CrackFrameFacts {
  player: Vec2;
  hidden: boolean;
  /** Player inside his leash disc (he gives up beyond it). */
  inLeash: boolean;
  /** His last public pose (≤ 1 frame old during a chase) and whether a wall / high cover now blocks the line to it. */
  lastPose: Vec2 | null;
  wallBetween: boolean | null;
  distanceToLastPoseM: number | null;
  /** Distance to him at THIS frame when R4 allows it now (e.g. the frame his chase starts), else null. */
  nowDistanceM: number | null;
  sightRangeM: number;
  proximityM: number;
  /** The last curse circle seen on the ground (public telegraph) and whether the player is inside it now. */
  lastCurse: { x: number; z: number; radiusM: number; landsAt: number } | null;
  insideLastCurse: boolean | null;
  /** The scan exposure during the last warning frame ('covered' = in the ring but protected). */
  lastScanExposure: 'exposed' | 'covered' | 'out' | null;
  areaName: string;
}

export class CrackstoneLive {
  private model: CrackstoneRiskModel;
  readonly tracker: CrackstoneTracker;
  private revision: number;
  private cached: CrackstoneForecast | null = null;
  private lastPose: Vec2 | null = null;
  private lastCurse: CrackFrameFacts['lastCurse'] = null;
  private lastScanExposure: CrackFrameFacts['lastScanExposure'] = null;
  readonly areaName: string;
  readonly polygon: { x: number; z: number }[];

  constructor(run: MysteryRun, model: CrackstoneRiskModel) {
    this.model = model;
    this.tracker = new CrackstoneTracker(model, 0);
    this.revision = run.world.revision;
    this.areaName = model.def.areaName;
    this.polygon = model.def.polygon.map((q) => ({ x: q.x, z: q.z }));
  }

  /** Per frame, BEFORE the frame's events: nothing; AFTER them: the public facts of this frame. */
  noteFrame(run: MysteryRun): void {
    const pub = crackstoneOf(run, false);
    const pose = pub?.pose ?? null;
    if (pose) this.lastPose = { x: pose.x, z: pose.z };
    this.tracker.notePublic(pose, pub !== null && pub.canSeePlayer, run.player);
    if (pub?.curse) this.lastCurse = { ...pub.curse };
    const ex = run.scanExposure();
    if (ex) this.lastScanExposure = ex;
  }

  /** Public facts for the WHY rules at an event of this frame (uses the PREVIOUS frame's public pose / telegraphs). */
  frameFacts(run: MysteryRun): CrackFrameFacts {
    const p = run.player;
    const m = this.model;
    const lp = this.lastPose;
    const lc = this.lastCurse;
    const now = crackstonePose(run, false).pose;
    return {
      player: { x: p.x, z: p.z }, hidden: p.hidden,
      inLeash: Math.hypot(p.x - m.centroid.x, p.z - m.centroid.z) <= m.def.leashM,
      lastPose: lp ? { ...lp } : null,
      wallBetween: lp ? !run.world.lineOfSight(lp.x, lp.z, p.x, p.z, false) : null,
      distanceToLastPoseM: lp ? Math.hypot(lp.x - p.x, lp.z - p.z) : null,
      nowDistanceM: now ? Math.hypot(now.x - p.x, now.z - p.z) : null,
      sightRangeM: (run.inFog(p.x, p.z) ? m.cfg.sight.fogRangeM : m.cfg.sight.rangeM) * (p.crouched ? m.cfg.sight.crouchRangeMult : 1),
      proximityM: m.cfg.proximityM,
      lastCurse: lc ? { x: lc.x, z: lc.z, radiusM: lc.radiusM, landsAt: lc.landsAt } : null,
      insideLastCurse: lc ? Math.hypot(p.x - lc.x, p.z - lc.z) <= lc.radiusM : null,
      lastScanExposure: this.lastScanExposure,
      areaName: this.areaName,
    };
  }

  /** Crackstone events of a frame → the tracker (mode / scan schedule / search focus). */
  onEvent(run: MysteryRun, e: StampedEvent): void {
    if (e.type === 'crackstone_mode') {
      this.tracker.onMode(e.t, e.from as CrackstoneMode, e.to as CrackstoneMode, e.reason, { player: { x: run.player.x, z: run.player.z }, lurePoint: run.fx.lurePoint ? { ...run.fx.lurePoint } : null });
    } else if (e.type === 'crackstone_scan') {
      this.tracker.onScan(e.t, e.phase);
      if (e.phase === 'pulse') this.lastScanExposure = null;
    }
    // curse events need nothing here: lastCurse is kept for the WHY of this frame and replaced on the next cast
  }

  clearScanMemory(): void {
    this.lastScanExposure = null;
  }

  /** 1 Hz: step the belief and rebuild the forecast. */
  sample(run: MysteryRun): CrackstoneForecast | null {
    if (run.world.revision !== this.revision) {
      const m = crackstoneRiskFor(run);
      if (m) {
        this.model = m;
        this.tracker.setModel(m);
      }
      this.revision = run.world.revision;
    }
    const pub = crackstoneOf(run, true);
    if (!pub) return null;
    const s = crackSampleOf(run, pub);
    this.tracker.sample(s);
    const out = this.tracker.forecast(s);
    const m = this.model;
    this.cached = {
      cells: m.cells.map((c, i) => ({ x: r2(c.x), z: r2(c.z), sizeM: m.cellM, p: r3(out.cells[i]) })),
      here: { p: r3(out.here), fact: factOf(pub, run.player.hidden) },
      horizonS: CRACK_HORIZON_S,
      label: CRACK_LABEL,
      area: { name: this.areaName, polygon: this.polygon.map((q) => ({ ...q })) },
      basis: out.basis,
      mode: pub.mode,
    };
    return this.cached;
  }

  /** The cached forecast with the instant fact (hunting / seen → p = 1 at once). */
  current(run: MysteryRun): CrackstoneForecast | null {
    const pub = crackstoneOf(run, false);
    if (!pub) return null;
    const base = this.cached ?? this.sample(run);
    if (!base) return null;
    const fact = factOf(pub, run.player.hidden);
    const p = fact === 'hunting' || fact === 'seen' ? 1 : base.here.p;
    return { ...base, here: { p, fact }, mode: pub.mode };
  }

  get riskModel(): CrackstoneRiskModel {
    return this.model;
  }
}

export function factOf(pub: CrackstonePublic, hidden: boolean): CrackstoneForecast['here']['fact'] {
  if (pub.active && (pub.mode === 'CHASE' || pub.mode === 'ATTACK')) return 'hunting';
  if (pub.canSeePlayer) return 'seen';
  if (hidden) return 'hidden';
  return null;
}

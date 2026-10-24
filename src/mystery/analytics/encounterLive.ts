// Live glue for the encounter odds of all three enemies (encounter.ts) — owned by LiveEngine. Uses the final sim's PUBLIC
// views: run.encounterDistribution(enemy) (the director's exact spawn distribution), run.enemyStatus() (present / active
// / phase / arrivesInS), run.cabinetStatus() (witness), publicState.ts (R4 position rule for every enemy). Runs of an
// older sim (no director views) keep the legacy behaviour: the Hyde emergence rule + zone filter, Crackstone always on.
import type { MysteryRun } from '../run.ts';
import type { CaseWorldDef, EnemyId, HydeMode, StampedEvent } from '../types.ts';
import { ENEMY_IDS, ENEMY_NAMES } from '../types.ts';
import { forward } from '../geometry.ts';
import {
  assembleThreatMap, buildSlurpModel, crackCellsByZone, EnemyZoneTracker, LABEL_NOISE_RULE, LABEL_SIGHT_RULES, LABEL_SPAWN_RULES,
  LABEL_WANDER_RULES, LABEL_ZONE_FILTER, r3, SLURP_FILTER_DEFAULTS, SLURP_SENSE, slurpCellGeometry, slurpEncounterP, slurpEncounterPath, slurpLooks,
  slurpObsMode, spawnOddsByArea, spawnOddsByZone, withinRadiusP, zoneFractionsWithin, type EnemyThreatLayer, type SlurpSenses,
  type ThreatMap,
} from './encounter.ts';
import { buildZoneModel, zoneIndexAt, type ZoneFilterParams } from './hydeZones.ts';
import { cabinetOf, crackstoneActiveOf, hydeActiveOf, hydeEmergedOf, hydeVisibleOf, investigationOf, slurpOf, visibleHydePosition, worldOf } from './publicState.ts';
import type { CrackstoneForecast, NoiseRisk, SlurpForecast, SpawnProb } from './types.ts';
import { slurpRiskP, type SlurpRiskPart } from './slurpModel.ts';

/** The per-enemy view model of the final sim (run.enemyStatus()). */
interface EnemyStatusLike { present: boolean; active: boolean; phase: 'inactive' | 'active' | 'cooldown'; mode: string; arrivesInS: number | null; engaged: boolean }

interface FinalRunViews {
  encounterDistribution?: (enemy: EnemyId) => { spawnId: string; name: string; zoneId: string; x: number; z: number; p: number }[];
  enemyStatus?: () => Record<EnemyId, EnemyStatusLike>;
  cabinetStatus?: () => { witnessedBy: EnemyId | null } | null;
  director?: { dynamic?: boolean; life?: (e: EnemyId) => { managed: boolean } | null } | null;
}

function views(run: MysteryRun): FinalRunViews {
  return run as unknown as FinalRunViews;
}

/** This enemy's spawns / despawns are run by the encounter director on this map (dynamic world, managed enemy). */
export function directorManages(run: MysteryRun, enemy: EnemyId): boolean {
  const d = views(run).director;
  if (!d || d.dynamic !== true || typeof d.life !== 'function') return false;
  return d.life(enemy)?.managed === true;
}

/** The enemy that saw the player hide in their current cabinet (public HUD fact), else null. */
export function witnessedBy(run: MysteryRun): EnemyId | null {
  const f = views(run).cabinetStatus;
  if (typeof f !== 'function') return null;
  return f.call(run)?.witnessedBy ?? null;
}

function patrolSpeed(run: Pick<MysteryRun, 'tuning'>): number {
  const v = (run.tuning.hyde as { speed?: Partial<Record<HydeMode, number>> }).speed?.PATROL;
  return typeof v === 'number' && v > 0 ? v : 2.4;
}

interface SlurpCfgLike { speed?: { WANDER?: number }; pauseMinS?: number; pauseMaxS?: number; proximityM?: number; sight?: { rangeM?: number; coneDeg?: number } }

function slurpCfg(run: Pick<MysteryRun, 'tuning'>): { speed: number; pauseS: number; senses: SlurpSenses } {
  const c = (run.tuning as unknown as { slurp?: SlurpCfgLike }).slurp;
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
  const pmin = n(c?.pauseMinS, 1.5);
  const pmax = n(c?.pauseMaxS, pmin);
  return {
    speed: n(c?.speed?.WANDER, 1.3),
    pauseS: (pmin + pmax) / 2,
    senses: {
      proximityM: n(c?.proximityM, SLURP_SENSE.proximityM),
      sightM: n(c?.sight?.rangeM, SLURP_SENSE.sightM),
      coneShare: Math.min(1, n(c?.sight?.coneDeg, 90) / 360),
    },
  };
}

export class EncounterLive {
  readonly world: CaseWorldDef | null;
  private readonly hydeTracker: EnemyZoneTracker | null;
  private readonly slurpTracker: EnemyZoneTracker | null;
  private readonly senses: SlurpSenses;
  private hydeP: number[] | null = null;
  private slurpP: number[] | null = null;
  private readonly cachedSpawns: Partial<Record<EnemyId, SpawnProb[]>> = {};
  private slurpCache: { t: number; key: string; f: SlurpForecast } | null = null;

  constructor(run: MysteryRun, hydeParams: ZoneFilterParams, private readonly slurpRisk: SlurpRiskPart | null = null) {
    this.world = worldOf(run);
    const zones = this.world?.zones ?? [];
    const hydePatrol = this.world?.playArea?.hydePatrol ?? run.map.patrol;
    this.hydeTracker = zones.length > 0 ? new EnemyZoneTracker(buildZoneModel(zones, hydePatrol, patrolSpeed(run), hydeParams)) : null;
    const sc = slurpCfg(run);
    this.senses = sc.senses;
    const sd = this.world?.slurp;
    this.slurpTracker = sd && sd.wander.length > 0 && zones.length > 0
      ? new EnemyZoneTracker(buildSlurpModel(zones, sd.wander, sc.speed, sc.pauseS, { ...SLURP_FILTER_DEFAULTS, chaseNearM: sc.senses.sightM }))
      : null;
  }

  /** Lifecycle events (in order, every frame): (re)start / stop the director-managed filters at spawns / despawns. */
  onEvent(e: StampedEvent): void {
    if (e.seq === 0) return;
    if (e.type === 'enemy_spawned') {
      if (e.enemy === 'hyde') this.hydeTracker?.spawn(e.t);
      if (e.enemy === 'slurp') this.slurpTracker?.spawn(e.t);
    } else if (e.type === 'enemy_despawned') {
      if (e.enemy === 'hyde') {
        this.hydeTracker?.despawn();
        this.hydeP = null;
      }
      if (e.enemy === 'slurp') {
        this.slurpTracker?.despawn();
        this.slurpP = null;
      }
    }
  }

  /** The director's EXACT spawn odds of `enemy` now (run.encounterDistribution), [] without a director view. */
  spawnOdds(run: MysteryRun, enemy: EnemyId): SpawnProb[] {
    const f = views(run).encounterDistribution;
    if (typeof f !== 'function') return [];
    return f.call(run, enemy).map((c) => ({ spawnId: c.spawnId, name: c.name, zoneId: c.zoneId, x: c.x, z: c.z, p: c.p }));
  }

  /** The sim's per-enemy status (null without the director views). */
  status(run: MysteryRun, enemy: EnemyId): EnemyStatusLike | null {
    const f = views(run).enemyStatus;
    return typeof f === 'function' ? f.call(run)[enemy] ?? null : null;
  }

  /** Seconds until an enemy that has not appeared yet may first appear (null = unknown / "Away" after a despawn). */
  appearsInS(run: MysteryRun, enemy: EnemyId): number | null {
    return this.status(run, enemy)?.arrivesInS ?? null;
  }

  activeOf(run: MysteryRun, enemy: EnemyId): boolean {
    if (enemy === 'hyde') return hydeActiveOf(run);
    if (enemy === 'crackstone') return crackstoneActiveOf(run);
    return slurpOf(run, false)?.active === true;
  }

  presentOf(run: MysteryRun, enemy: EnemyId): boolean {
    const st = this.status(run, enemy);
    if (st) return st.present;
    if (enemy === 'hyde') return true;
    if (enemy === 'crackstone') return !!run.crackstoneBrain;
    return slurpOf(run, false) !== null;
  }

  /** 1 Hz: inactive spawn odds (remembered as the next spawn's prior), then the director-managed Hyde / Slurp filters. */
  sample(run: MysteryRun, snapshotVisible?: boolean): void {
    const w = this.world;
    if (!w || w.zones.length === 0) return;
    const t = run.t;
    const player = { x: run.player.x, z: run.player.z };
    for (const enemy of ENEMY_IDS) {
      if (!directorManages(run, enemy) || this.activeOf(run, enemy)) continue;
      const odds = this.spawnOdds(run, enemy);
      this.cachedSpawns[enemy] = odds;
      const zp = spawnOddsByZone(w.zones, odds);
      if (enemy === 'hyde') this.hydeTracker?.noteSpawnOdds(zp);
      if (enemy === 'slurp') this.slurpTracker?.noteSpawnOdds(zp);
    }
    if (directorManages(run, 'hyde') && this.hydeTracker && hydeActiveOf(run)) {
      const visible = hydeVisibleOf(run, snapshotVisible);
      this.hydeP = this.hydeTracker.step(t, { player, mode: run.hyde.mode, visible, pos: visibleHydePosition(run, visible) });
    }
    const sl = slurpOf(run, true);
    if (this.slurpTracker && sl && sl.active) {
      this.slurpP = this.slurpTracker.step(t, { player, mode: slurpObsMode(sl.mode), visible: sl.pose !== null, pos: sl.pose ? { x: sl.pose.x, z: sl.pose.z } : null });
    }
  }

  /** Director-managed Hyde zone odds while active (null = the legacy tracker applies / not active). */
  hydeZones(run: MysteryRun): number[] | null {
    if (!directorManages(run, 'hyde') || !hydeActiveOf(run)) return null;
    return this.hydeP ? [...this.hydeP] : this.hydeTracker?.probs() ?? null;
  }

  private inactiveLayer(run: MysteryRun, enemy: EnemyId): EnemyThreatLayer {
    const w = this.world!;
    const spawns = this.spawnOdds(run, enemy);
    const zp = spawnOddsByZone(w.zones, spawns);
    const own = zoneIndexAt(w.zones, run.player.x, run.player.z);
    return {
      enemy, name: ENEMY_NAMES[enemy], state: 'inactive', basis: 'spawn_rules', label: LABEL_SPAWN_RULES, meaning: 'appear',
      zones: w.zones.map((z, i) => ({ zoneId: z.id, p: r3(zp[i]) })), mode: null, appearsInS: this.appearsInS(run, enemy),
      spawns: spawns.map((s) => ({ ...s, p: r3(s.p) })), areas: spawnOddsByArea(w, spawns), here: own >= 0 ? r3(zp[own]) : null,
    };
  }

  /**
   * Every enemy layer of this case + the combined map. `hydeZoneP` = the Hyde's zone odds the live engine shows,
   * `legacyHydeSpawns` = the pre-emergence spawn rule of a director-less run.
   */
  threatMap(run: MysteryRun, hydeZoneP: readonly number[] | null, legacyHydeSpawns: SpawnProb[] | null, crack: CrackstoneForecast | null): ThreatMap | null {
    const w = this.world;
    if (!w || w.zones.length === 0) return null;
    const zones = w.zones;
    const player = { x: run.player.x, z: run.player.z };
    const own = zoneIndexAt(zones, player.x, player.z);
    const layers: EnemyThreatLayer[] = [];
    // ---- Hyde
    if (hydeActiveOf(run)) {
      if (hydeZoneP && hydeZoneP.length === zones.length) {
        layers.push({
          enemy: 'hyde', name: ENEMY_NAMES.hyde, state: 'active', basis: 'zone_filter', label: LABEL_ZONE_FILTER, meaning: 'location',
          zones: zones.map((z, i) => ({ zoneId: z.id, p: r3(hydeZoneP[i]) })), mode: run.hyde.mode, appearsInS: null,
          here: own >= 0 ? r3(hydeZoneP[own]) : null,
        });
      }
    } else if (directorManages(run, 'hyde')) layers.push(this.inactiveLayer(run, 'hyde'));
    else if (legacyHydeSpawns && legacyHydeSpawns.length > 0) {
      const zp = spawnOddsByZone(zones, legacyHydeSpawns);
      const inv = investigationOf(run);
      layers.push({
        enemy: 'hyde', name: ENEMY_NAMES.hyde, state: 'inactive', basis: 'spawn_rules', label: LABEL_SPAWN_RULES, meaning: 'appear',
        zones: zones.map((z, i) => ({ zoneId: z.id, p: r3(zp[i]) })), mode: null,
        appearsInS: hydeEmergedOf(run, inv) ? null : Math.max(0, inv.hydeEmergesInS ?? 0),
        spawns: legacyHydeSpawns.map((s) => ({ ...s, p: r3(s.p) })), areas: spawnOddsByArea(w, legacyHydeSpawns), here: own >= 0 ? r3(zp[own]) : null,
      });
    }
    // ---- Crackstone
    if (this.presentOf(run, 'crackstone')) {
      if (crackstoneActiveOf(run) && crack) {
        const zp = crackCellsByZone(zones, crack.cells);
        layers.push({
          enemy: 'crackstone', name: ENEMY_NAMES.crackstone, state: 'active', basis: 'sight_rules', label: LABEL_SIGHT_RULES, meaning: 'sight',
          zones: zones.map((z, i) => ({ zoneId: z.id, p: r3(zp[i]) })), mode: crack.mode ?? null, appearsInS: null, here: r3(crack.here.p),
        });
      } else if (!crackstoneActiveOf(run) && directorManages(run, 'crackstone')) layers.push(this.inactiveLayer(run, 'crackstone'));
    }
    // ---- Slurp
    if (this.presentOf(run, 'slurp')) {
      const sl = slurpOf(run, false);
      const f = this.slurpForecast(run);
      if (sl && sl.active && f && this.slurpTracker) {
        const sp = this.slurpP ?? this.slurpTracker.model.occupancy;
        layers.push({
          enemy: 'slurp', name: ENEMY_NAMES.slurp, state: 'active', basis: 'wander_rules', label: LABEL_WANDER_RULES, meaning: 'location',
          zones: zones.map((z, i) => ({ zoneId: z.id, p: r3(sp[i]) })), mode: sl.mode, appearsInS: null, here: f.here.p,
        });
      } else if (!(sl && sl.active) && directorManages(run, 'slurp')) layers.push(this.inactiveLayer(run, 'slurp'));
    }
    return assembleThreatMap(zones, layers, player);
  }

  /** Hyde detection risk from noise (rule): P(Hyde within your footsteps' hearing radius). Null while it is not active. */
  noiseRisk(run: MysteryRun, hydeZoneP: readonly number[] | null): NoiseRisk | null {
    const w = this.world;
    if (!w || !hydeActiveOf(run) || !hydeZoneP || hydeZoneP.length !== w.zones.length) return null;
    const r = run.noiseRadiusM();
    const player = { x: run.player.x, z: run.player.z };
    if (hydeVisibleOf(run)) {
      const pos = visibleHydePosition(run, true)!;
      return { radiusM: Math.round(r * 10) / 10, p: Math.hypot(pos.x - player.x, pos.z - player.z) <= r ? 1 : 0, fact: 'visible', label: LABEL_NOISE_RULE };
    }
    return { radiusM: Math.round(r * 10) / 10, p: r3(withinRadiusP(w.zones, hydeZoneP, player, r)), fact: null, label: LABEL_NOISE_RULE };
  }

  /**
   * Slurp's rule-based risk while he is on the map (UX_FINAL Asks): cells + `here` = P(he finds you within 15 s); facts:
   * hunting (CHASE / ATTACK, or he saw you hide here) · seen (he sees you) · hidden (door closed: invisible; crouch spot /
   * open door: only his proximity counts). Null while he is absent / away.
   */
  slurpForecast(run: MysteryRun): SlurpForecast | null {
    const w = this.world;
    const sl = slurpOf(run, false);
    if (!w || !sl || !sl.active || !this.slurpTracker) return null;
    const cab = cabinetOf(run);
    const key = `${sl.mode}|${sl.canSeePlayer}|${cab?.phase ?? ''}|${run.player.x.toFixed(1)},${run.player.z.toFixed(1)}|${run.player.hidden}|${run.player.speed.toFixed(1)},${run.player.yaw.toFixed(2)}`;
    if (this.slurpCache && this.slurpCache.t === run.t && this.slurpCache.key === key) return this.slurpCache.f;
    const model = this.slurpTracker.model;
    const zp = this.slurpP ?? this.slurpTracker.probs() ?? model.occupancy;
    const sd = w.slurp;
    let disc: { x: number; z: number; r: number } | null = null;
    if (sd && sd.wander.length > 0 && sd.leashM > 0) {
      const c = sd.wander.reduce((a, q) => ({ x: a.x + q.x / sd.wander.length, z: a.z + q.z / sd.wander.length }), { x: 0, z: 0 });
      disc = { x: c.x, z: c.z, r: sd.leashM + this.senses.sightM };
    }
    const geo = slurpCellGeometry(w.zones, disc, this.senses);
    const looks = slurpLooks(model, zp);
    // searching / investigating he sweeps all around (no facing cone); wandering he looks where he walks
    const cs = sl.mode === 'SEARCH' || sl.mode === 'INVESTIGATE' ? 1 : this.senses.coneShare;
    const cells = geo.cells.map((c, i) => ({ x: c.x, z: c.z, sizeM: SLURP_SENSE.cellM, p: r3(slurpEncounterP(looks, geo.near[i], geo.far[i], false, cs)) }));
    const p = run.player;
    let fact: SlurpForecast['here']['fact'] = null;
    let here: number;
    let ruleP: number;
    let ml = false;
    if (sl.mode === 'CHASE' || sl.mode === 'ATTACK' || (cab && witnessedBy(run) === 'slurp')) {
      fact = 'hunting';
      here = ruleP = 1;
    } else if (cab && cab.phase === 'closed') {
      fact = 'hidden';
      here = ruleP = 0;
    } else if (sl.canSeePlayer) {
      fact = 'seen';
      here = ruleP = 1;
    } else {
      const hidden = p.hidden || (cab !== null && cab.phase === 'open');
      if (hidden) fact = 'hidden';
      // "if you keep moving like this": look k at your position + velocity × h (your own pose and speed are public; a
      // hidden / standing player stays put). The 4 m cells stay stand-still estimates per spot.
      const f = forward(p.yaw);
      const v = hidden ? 0 : p.speed;
      const at = SLURP_SENSE.looksS.map((h) => ({ x: p.x + f.x * v * h, z: p.z + f.z * v * h }));
      here = slurpEncounterPath(looks, at.map((q) => zoneFractionsWithin(w.zones, q, this.senses.proximityM)),
        at.map((q) => zoneFractionsWithin(w.zones, q, this.senses.sightM)), hidden, cs);
      ruleP = here;
      if (this.slurpRisk) {
        here = slurpRiskP(this.slurpRisk, { ruleP, mode: sl.mode, stance: p.stance, hidden });
        ml = true;
      }
    }
    const f: SlurpForecast = {
      cells, here: { p: r3(here), fact }, horizonS: SLURP_SENSE.horizonS, label: ml ? 'ML estimate' : 'Rule-based estimate', ruleP: r3(ruleP),
      cellsLabel: 'Rule-based estimate', mode: sl.mode,
    };
    this.slurpCache = { t: run.t, key, f };
    return f;
  }

  /** The latest inactive spawn odds sampled for an enemy (uploads). */
  sampledSpawns(enemy: EnemyId): SpawnProb[] | null {
    return this.cachedSpawns[enemy] ?? null;
  }
}

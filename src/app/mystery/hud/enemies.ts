// Final HUD (docs/final/UX_FINAL.md §1a/§1d): the three monsters on ONE Threats strip + the minimap danger-view lens.
// Pure view-model over the sim's PUBLIC enemy state, FEATURE-DETECTED (the director / Slurp land in parallel):
//   1. run.enemyStatus()               game-developer view-model (array or record of {enemy, present, active, mode,
//                                      arrivesInS, engaged, phase})
//   2. run.director.view(enemy, t)     EncounterDirector lifecycle view (phase inactive / active / cooldown)
//   3. legacy                          Hyde emergence countdown (InvestigationState.hydeEmergesInS), Crackstone brain
//                                      `active`, run.slurp.active
// Positions are never read here (R4 lives in crackstone.ts / slurpMarkerKind below).
import type { EnemyId, HydeMode, SlurpMode, SlurpRuntime, Vec2 } from '../../../mystery/types.ts';
import { ENEMY_IDS } from '../../../mystery/types.ts';
import type { HudIconName } from '../../../ui/mystery/hud/HudIcon.tsx';
import { CRACK_THREAT, type CrackPillKey } from './crackstone.ts';

// ------------------------------------------------------------------------------------------------- lifecycle adapter

export type LifePhase = 'inactive' | 'active' | 'cooldown';

/** One enemy's public lifecycle (director) state. */
export interface EnemyLife {
  enemy: EnemyId;
  /** Part of this case. */
  present: boolean;
  /** On the map now. */
  active: boolean;
  /** inactive = never spawned yet · active · cooldown = despawned ("Away"). */
  phase: LifePhase;
  /** Seconds until the director may spawn it (inactive / cooldown), null = unknown / now. */
  arrivesInS: number | null;
  /** It has been on the map at least once. */
  everActive: boolean;
}

type Loose = Record<string, unknown>;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const isObj = (v: unknown): v is Loose => v !== null && typeof v === 'object';

interface FinalRunApi {
  t?: number;
  status?: string;
  enemyStatus?: () => unknown;
  director?: { view?: (enemy: EnemyId, t: number) => unknown; has?: (enemy: EnemyId) => boolean } | null;
  hydeEmerged?: boolean;
  hydeBrain?: { active?: boolean };
  crackstone?: unknown;
  crackstoneBrain?: { active?: boolean } | null;
  slurp?: SlurpRuntime | null;
  slurpVisible?: () => boolean;
  slurpBearing?: () => { angle: number; distanceM: number };
  map?: { world?: { slurp?: unknown; crackstone?: unknown } | null };
  tuning?: { slurp?: { suspicion?: { chaseAt?: number } } };
}

/** The raw per-enemy record of run.enemyStatus(), whatever its container shape (array or record). */
export function enemyStatusEntry(run: object, enemy: EnemyId): Loose | null {
  const r = run as FinalRunApi;
  if (typeof r.enemyStatus !== 'function') return null;
  let all: unknown;
  try {
    all = r.enemyStatus();
  } catch {
    return null;
  }
  if (Array.isArray(all)) return (all.find((x) => isObj(x) && (x.enemy === enemy || x.id === enemy)) as Loose | undefined) ?? null;
  if (isObj(all) && isObj(all[enemy])) return all[enemy] as Loose;
  return null;
}

function phaseOf(v: unknown): LifePhase | null {
  if (v === 'inactive' || v === 'active' || v === 'cooldown') return v;
  if (v === 'despawned' || v === 'away') return 'cooldown';
  if (v === 'spawned') return 'active';
  return null;
}

/**
 * Public lifecycle of one enemy. `legacyHyde` = the overhaul emergence state (emerged + countdown) for sims without a
 * director. Returns present: false when the enemy is not part of this run.
 */
export function enemyLife(run: object, enemy: EnemyId, legacyHyde: { emerged: boolean; emergesInS: number | null }): EnemyLife {
  const r = run as FinalRunApi;
  const t = num(r.t) ?? 0;
  const st = enemyStatusEntry(run, enemy);
  if (st) {
    const present = st.present !== false;
    const active = st.active === true || st.phase === 'active';
    const phase = phaseOf(st.phase) ?? (active ? 'active' : st.everActive === true || num(st.despawnedAt) !== null ? 'cooldown' : 'inactive');
    const arrivesInS = num(st.arrivesInS) ?? num(st.nextSpawnInS);
    return { enemy, present, active, phase, arrivesInS: active ? null : arrivesInS, everActive: active || phase === 'cooldown' || st.everActive === true };
  }
  const present = enemyPresent(run, enemy);
  if (!present) return { enemy, present: false, active: false, phase: 'inactive', arrivesInS: null, everActive: false };
  const dv = typeof r.director?.view === 'function' ? r.director.view(enemy, t) : null;
  if (isObj(dv) && phaseOf(dv.phase)) {
    const phase = phaseOf(dv.phase)!;
    const active = phase === 'active';
    const managed = dv.managed !== false;
    // unmanaged (legacy world): the Hyde's one-shot emergence countdown still applies
    const arrivesInS = active ? null : managed ? num(dv.nextSpawnInS) : enemy === 'hyde' ? legacyHyde.emergesInS : null;
    return { enemy, present, active, phase, arrivesInS, everActive: active || phase === 'cooldown' || num(dv.spawnedAt) !== null };
  }
  const active = enemyActiveLegacy(run, enemy, legacyHyde) ?? false;
  if (enemy === 'hyde') {
    return { enemy, present, active, phase: active ? 'active' : 'inactive', arrivesInS: active ? null : legacyHyde.emergesInS, everActive: legacyHyde.emerged };
  }
  return { enemy, present, active, phase: active ? 'active' : 'inactive', arrivesInS: null, everActive: active };
}

/** The enemy is part of this run (case data / runtime present). */
export function enemyPresent(run: object, enemy: EnemyId): boolean {
  const r = run as FinalRunApi;
  if (enemy === 'hyde') return true;
  if (enemy === 'crackstone') return !!r.crackstone;
  return !!r.slurp;
}

function enemyActiveLegacy(run: object, enemy: EnemyId, legacyHyde: { emerged: boolean }): boolean | null {
  const r = run as FinalRunApi;
  if (enemy === 'hyde') return legacyHyde.emerged && r.hydeBrain?.active !== false;
  if (enemy === 'crackstone') return r.crackstone ? r.crackstoneBrain?.active !== false && r.status !== 'tutorial' : null;
  return r.slurp ? r.slurp.active === true : null;
}

/** Slurp's runtime (mode, suspicion, canSeePlayer, attacking) — null without him. Position = hidden truth unless R4. */
export function slurpOf(run: object): SlurpRuntime | null {
  const s = (run as FinalRunApi).slurp;
  return s && typeof s === 'object' && typeof s.mode === 'string' ? s : null;
}

export function slurpChaseAt(run: object): number {
  return Math.max(1e-6, num((run as FinalRunApi).tuning?.slurp?.suspicion?.chaseAt) ?? 1);
}

export type SlurpMarkerKind = 'visible' | 'chase' | 'attack' | 'revealed';

/** R4 for Slurp: his position is public only while the player sees him, he chases / attacks, or a reveal shows him. */
export function slurpMarkerKind(run: object, fx: { enemiesRevealed: boolean; enemyRevealRangeM: number }, player: Vec2): SlurpMarkerKind | null {
  const s = slurpOf(run);
  if (!s || !s.active) return null;
  if (s.mode === 'ATTACK' || s.attacking) return 'attack';
  if (s.mode === 'CHASE') return 'chase';
  const r = run as FinalRunApi;
  if (typeof r.slurpVisible === 'function' && r.slurpVisible()) return 'visible';
  if (fx.enemiesRevealed) {
    const d = Math.hypot(s.x - player.x, s.z - player.z);
    if (fx.enemyRevealRangeM <= 0 || d <= fx.enemyRevealRangeM) return 'revealed';
  }
  return null;
}

// ------------------------------------------------------------------------------------------------- Threats strip

export type SlurpChipKey = 'WANDER' | 'SEES' | 'INVESTIGATE' | 'SEARCH' | 'CHASE' | 'ATTACK' | 'LEAVE';

/** UX_FINAL §1a Slurp table (words exactly as §8 copy). */
export const SLURP_THREAT: Record<SlurpChipKey, { word: string; icon: HudIconName }> = {
  WANDER: { word: 'Wandering', icon: 'slurp' },
  SEES: { word: 'SEES YOU', icon: 'eye' },
  INVESTIGATE: { word: 'Heard something', icon: 'ear' },
  SEARCH: { word: 'Searching', icon: 'search' },
  CHASE: { word: 'CHASING YOU', icon: 'slurp' },
  ATTACK: { word: 'GRABBING', icon: 'slurp' },
  LEAVE: { word: 'Wandering off', icon: 'reset' },
};

/** CHASE / ATTACK first, then "SEES YOU" (sees you, not chasing), else his mode. */
export function slurpChipKey(s: Pick<SlurpRuntime, 'mode' | 'canSeePlayer' | 'attacking'>): SlurpChipKey {
  if (s.mode === 'ATTACK' || s.attacking) return 'ATTACK';
  if (s.mode === 'CHASE') return 'CHASE';
  if (s.canSeePlayer) return 'SEES';
  return s.mode as SlurpMode;
}

/** Hyde chip words (the existing THREAT table) + icons. */
export const HYDE_CHIP: Record<HydeMode, { word: string; icon: HudIconName }> = {
  PATROL: { word: 'Patrolling', icon: 'eyeClosed' },
  INVESTIGATE_SOUND: { word: 'Heard a noise', icon: 'ear' },
  SEARCH: { word: 'Searching', icon: 'search' },
  CHASE: { word: 'CHASING YOU', icon: 'claw' },
  COOLDOWN: { word: 'Losing interest', icon: 'hourglass' },
};

export const ENEMY_KICKER: Record<EnemyId, string> = { hyde: 'HYDE', crackstone: 'CRACKSTONE', slurp: 'SLURP' };
/** {Name} in short copy ("{Name} saw you hide! Get out now.", game-over flavour) — UX_FINAL §8. */
export const ENEMY_SHORT: Record<EnemyId, string> = { hyde: 'The Hyde', crackstone: 'Crackstone', slurp: 'Slurp' };

export type DirectorChip = 'arrives' | 'soon' | 'away';

export interface ThreatChipView {
  enemy: EnemyId;
  kicker: string;
  /** data-state: the mode key, or ARRIVES / SOON / AWAY for the director states. */
  state: string;
  word: string;
  icon: HudIconName;
  /** Bottom meter 0..1 (suspicion); null for director states. */
  meter: number | null;
  director: DirectorChip | null;
  effect: { word: string; leftS: number | null } | null;
  /** aria-live assertive (CHASE / ATTACK only). */
  assertive: boolean;
}

/** "0:20" (ceil seconds). */
export function fmtClock(s: number): string {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}

/** Director chip for an enemy that is not on the map (null when active). */
export function directorChip(life: EnemyLife): ThreatChipView | null {
  if (!life.present || life.active) return null;
  let director: DirectorChip;
  let word: string;
  if (life.phase === 'cooldown') {
    director = 'away';
    word = 'Away';
  } else if (life.arrivesInS !== null && life.arrivesInS > 0.05) {
    director = 'arrives';
    word = `Arrives in ${fmtClock(life.arrivesInS)}`;
  } else {
    director = 'soon';
    word = 'Arriving soon';
  }
  return {
    enemy: life.enemy, kicker: ENEMY_KICKER[life.enemy], state: director.toUpperCase(), word, icon: director === 'away' ? 'reset' : 'hourglass',
    meter: null, director, effect: null, assertive: false,
  };
}

export function hydeChip(mode: HydeMode, suspicion: number, effect: ThreatChipView['effect']): ThreatChipView {
  const t = HYDE_CHIP[mode];
  return { enemy: 'hyde', kicker: 'HYDE', state: mode, word: t.word, icon: t.icon, meter: clamp01(suspicion), director: null, effect, assertive: mode === 'CHASE' };
}

export function crackChip(key: CrackPillKey, meter: number, effect: ThreatChipView['effect']): ThreatChipView {
  const t = CRACK_THREAT[key];
  return { enemy: 'crackstone', kicker: 'CRACKSTONE', state: key, word: t.word, icon: t.icon, meter: clamp01(meter), director: null, effect, assertive: key === 'CHASE' || key === 'ATTACK' };
}

export function slurpChip(key: SlurpChipKey, meter: number, effect: ThreatChipView['effect']): ThreatChipView {
  const t = SLURP_THREAT[key];
  return { enemy: 'slurp', kicker: 'SLURP', state: key, word: t.word, icon: t.icon, meter: clamp01(meter), director: null, effect, assertive: key === 'CHASE' || key === 'ATTACK' };
}

/** Fixed order Hyde · Crackstone · Slurp; absent monsters omitted. */
export function orderChips(chips: readonly (ThreatChipView | null)[]): ThreatChipView[] {
  return ENEMY_IDS.map((id) => chips.find((c) => c?.enemy === id) ?? null).filter((c): c is ThreatChipView => c !== null);
}

/** Holds a displayed key ≥ holdS (no flicker); `bypass` keys (CHASE / ATTACK) switch at once. */
export class KeyHold<K extends string> {
  private since = -Infinity;
  constructor(public shown: K, private readonly holdS = 0.5, private readonly bypass: readonly K[] = []) {}
  update(key: K, now: number): K {
    if (key !== this.shown && (now - this.since >= this.holdS || this.bypass.includes(key))) {
      this.shown = key;
      this.since = now;
    }
    return this.shown;
  }
}

/** Slurp effect chip (stun / slow / distract) from his own timers. */
export function slurpEffect(s: Pick<SlurpRuntime, 'stunnedUntil' | 'slowedUntil' | 'distractedUntil'>, t: number): ThreatChipView['effect'] {
  const left = (until: number) => (until > t ? Math.round((until - t) * 10) / 10 : null);
  if (s.stunnedUntil > t) return { word: 'STUNNED', leftS: left(s.stunnedUntil) };
  if (s.slowedUntil > t) return { word: 'SLOWED', leftS: left(s.slowedUntil) };
  if (s.distractedUntil > t) return { word: 'DISTRACTED', leftS: left(s.distractedUntil) };
  return null;
}

/** Is any monster hunting the player now (CHASE / ATTACK)? (Weems: "Not while hunted".) */
export function huntedBy(chips: readonly ThreatChipView[]): EnemyId | null {
  return chips.find((c) => c.director === null && (c.state === 'CHASE' || c.state === 'ATTACK'))?.enemy ?? null;
}

// ------------------------------------------------------------------------------------------------- lens (danger view)

export type LensChoice = 'auto' | EnemyId;

/** X cycles Auto → Hyde → Crackstone → Slurp → Auto, skipping monsters absent from this case. */
export function nextLens(cur: LensChoice, present: readonly EnemyId[]): LensChoice {
  const order: LensChoice[] = ['auto', ...ENEMY_IDS.filter((e) => present.includes(e))];
  const i = order.indexOf(cur);
  return order[(i + 1) % order.length] ?? 'auto';
}

export interface LensInput {
  present: readonly EnemyId[];
  active: readonly EnemyId[];
  /** Enemies at INVESTIGATE or above (investigate / search / chase / attack), most urgent first. */
  engaged: readonly EnemyId[];
  /** Odds row p per enemy (null = no number). */
  oddsP: Partial<Record<EnemyId, number | null>>;
}

/** Auto choice now: engaged enemy > active enemy with the highest Odds p > Hyde (if present) > first present. */
export function autoLensNow(i: LensInput): EnemyId {
  const eng = i.engaged.find((e) => i.present.includes(e));
  if (eng) return eng;
  let best: EnemyId | null = null;
  let bestP = -1;
  for (const e of ENEMY_IDS) {
    if (!i.active.includes(e)) continue;
    const p = i.oddsP[e];
    if (typeof p === 'number' && p > bestP) {
      bestP = p;
      best = e;
    }
  }
  if (best) return best;
  return i.present.includes('hyde') ? 'hyde' : i.present[0] ?? 'hyde';
}

export const LENS_HOLD_S = 4;

/** The auto lens with a 4 s hysteresis (an enemy that starts CHASE / ATTACK may take over at once via `urgent`). */
export class LensPicker {
  choice: LensChoice = 'auto';
  private shown: EnemyId | null = null;
  private since = -Infinity;

  cycle(present: readonly EnemyId[]): LensChoice {
    this.choice = nextLens(this.choice, present);
    return this.choice;
  }

  /** The enemy whose layer the minimap draws now. */
  update(i: LensInput, now: number, urgent: EnemyId | null = null): { enemy: EnemyId; auto: boolean } {
    if (this.choice !== 'auto') {
      if (i.present.includes(this.choice)) return { enemy: this.choice, auto: false };
      this.choice = 'auto';
    }
    const want = urgent && i.present.includes(urgent) ? urgent : autoLensNow(i);
    if (this.shown === null || (want !== this.shown && (now - this.since >= LENS_HOLD_S || (urgent !== null && want === urgent)))) {
      if (want !== this.shown) this.since = now;
      this.shown = want;
    }
    if (!i.present.includes(this.shown)) {
      this.shown = want;
      this.since = now;
    }
    return { enemy: this.shown, auto: true };
  }
}

export const LENS_BASE: Record<EnemyId, string> = { hyde: 'Hyde odds', crackstone: 'Crackstone sight', slurp: 'Slurp odds' };

/** Lens bar label (§8): "{Hyde odds / Crackstone sight / Slurp odds}{ · auto}", inactive enemy → "… · may appear". */
export function lensLabel(enemy: EnemyId, auto: boolean, inactive: boolean): string {
  return `${LENS_BASE[enemy]}${lensSuffix(auto, inactive) ? ` · ${lensSuffix(auto, inactive)}` : ''}`;
}

/** The part after the base name ("auto", "may appear", "auto · may appear"; '' = none) — the bar's second line. */
export function lensSuffix(auto: boolean, inactive: boolean): string {
  return [auto ? 'auto' : null, inactive ? 'may appear' : null].filter(Boolean).join(' · ');
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

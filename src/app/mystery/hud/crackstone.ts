// Joseph Crackstone on the HUD (docs/overhaul/UX_ENEMIES.md; ENEMY_CONTRACT R4 / R6 / R9). Pure view-model pieces over
// the sim's PUBLIC Crackstone API, feature-detected so test doubles and runs without him (fixtures, crackstone: null)
// simply return null and nothing renders:
//   * crackstoneOf(run)        the public handle (def = cursed area name + outline, runtime telegraphs, tuning numbers)
//   * crackMarkerKind(...)     R4: his POSITION is public only while the player sees him, while he chases / curses, or
//                              while a reveal effect shows enemies in range — otherwise null (never truth-based)
//   * crackMapState(...)       the minimap / Tab map slice (area, marker, curse circle, scan ring ONLY with the marker)
//   * crackPillKey / CRACK_THREAT / CrackThreatHold   the squared status plaque (§1)
//   * TelegraphTracker         the scan / curse banner with exposure-aware copy (§2), the CURSED vitals row, SR lines
//   * AlertLimiter             ThingStack rate limits for CRACKSTONE items (§6)
// Every number shown (countdowns, HP lost, slow seconds) comes from the runtime, the events or the resolved tuning.
import type { ActiveEffects, CrackstoneMode, CrackstoneRuntime, GameEvent, Vec2 } from '../../../mystery/types.ts';
import type { IconName } from '../../../ui/Icon.tsx';

export type Exposure = 'exposed' | 'covered' | 'out';

/** Resolved Crackstone tuning numbers the HUD needs (from run.crackstoneBrain.cfg). */
export interface CrackTuning {
  chaseAt: number;
  coneDeg: number;
  scanWarnS: number;
  scanRadiusM: number;
  curseWindupS: number;
  curseSlowS: number;
  curseHp: number;
}

/** Structural view of the sim's Crackstone API (src/mystery/run.ts). */
interface CrackRunApi {
  crackstone?: CrackstoneRuntime | null;
  crackstoneBrain?: {
    cfg?: { suspicion?: { chaseAt?: number }; sight?: { coneDeg?: number }; scanWarnS?: number; scanRadiusM?: number; curseWindupS?: number; curseSlowS?: number; curseHp?: number };
    active?: boolean;
    isLured?: (t: number) => boolean;
  } | null;
  crackstoneDef?: { areaName: string; polygon: Vec2[] } | null;
  crackstoneVisible?: () => boolean;
  crackstoneBearing?: () => { angle: number; distanceM: number };
  scanExposure?: () => Exposure | null;
  curseExposure?: () => Exposure | null;
  crackstoneVisual?: () => 'petrify' | 'pin' | null;
  player?: { x: number; z: number; yaw: number };
  t?: number;
}

export interface CrackHandle {
  /** Public cursed area (name + outline). */
  area: { name: string; polygon: Vec2[] };
  /** The runtime object (mode, suspicion, canSeePlayer and the PUBLIC telegraphs `scan` / `curse`). Its x / z are
   *  hidden truth unless crackMarkerKind() says otherwise. */
  rt: CrackstoneRuntime;
  tuning: CrackTuning;
  active: () => boolean;
  visible: () => boolean;
  bearing: () => { angle: number; distanceM: number } | null;
  scanExposure: () => Exposure | null;
  curseExposure: () => Exposure | null;
  lured: (t: number) => boolean;
  /** How he is held by an effect: stone ('petrify') vs spectral shackle ('pin'); null = not held. */
  visual: () => 'petrify' | 'pin' | null;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** The run's Crackstone, or null when the case has none / the sim predates him. */
export function crackstoneOf(run: object): CrackHandle | null {
  const r = run as CrackRunApi;
  const rt = r.crackstone;
  const def = r.crackstoneDef;
  if (!rt || !def || !Array.isArray(def.polygon)) return null;
  const brain = r.crackstoneBrain ?? null;
  const cfg = brain?.cfg ?? {};
  return {
    area: { name: def.areaName, polygon: def.polygon },
    rt,
    tuning: {
      chaseAt: Math.max(1e-6, num(cfg.suspicion?.chaseAt, 1)),
      coneDeg: num(cfg.sight?.coneDeg, 90),
      scanWarnS: num(cfg.scanWarnS, 2),
      scanRadiusM: num(cfg.scanRadiusM, 10),
      curseWindupS: num(cfg.curseWindupS, 1.4),
      curseSlowS: num(cfg.curseSlowS, 0),
      curseHp: num(cfg.curseHp, 0),
    },
    active: () => brain?.active !== false,
    visible: () => (typeof r.crackstoneVisible === 'function' ? !!r.crackstoneVisible() : false),
    bearing: () => {
      if (typeof r.crackstoneBearing !== 'function') return null;
      const b = r.crackstoneBearing();
      return b.distanceM >= 999 ? null : b;
    },
    scanExposure: () => (typeof r.scanExposure === 'function' ? r.scanExposure() : null),
    curseExposure: () => (typeof r.curseExposure === 'function' ? r.curseExposure() : null),
    lured: (t) => (typeof brain?.isLured === 'function' ? brain.isLured(t) : false),
    visual: () => (typeof r.crackstoneVisual === 'function' ? r.crackstoneVisual() : null),
  };
}

// ------------------------------------------------------------------------------------------------- R4 position rule

export type CrackMarkerKind = 'visible' | 'chase' | 'attack' | 'revealed';

/** A reveal effect shows enemies within `enemyRevealRangeM` of the player (0 = anywhere). */
export function revealedByEffect(fx: Pick<ActiveEffects, 'enemiesRevealed' | 'enemyRevealRangeM'>, distanceM: number): boolean {
  return !!fx.enemiesRevealed && (fx.enemyRevealRangeM <= 0 || distanceM <= fx.enemyRevealRangeM);
}

/**
 * R4: why the player may see Crackstone's position right now, or null (then the HUD / minimap / compass must not use
 * rt.x / rt.z). Inactive (tutorial) → null.
 */
export function crackMarkerKind(c: CrackHandle, fx: Pick<ActiveEffects, 'enemiesRevealed' | 'enemyRevealRangeM'>, player: Vec2): CrackMarkerKind | null {
  if (!c.active()) return null;
  if (c.rt.mode === 'ATTACK') return 'attack';
  if (c.rt.mode === 'CHASE') return 'chase';
  if (c.visible()) return 'visible';
  if (revealedByEffect(fx, Math.hypot(c.rt.x - player.x, c.rt.z - player.z))) return 'revealed';
  return null;
}

/** The map slice (PublicMapState.crack). */
export interface CrackMapState {
  area: { name: string; polygon: Vec2[] };
  /** R4 only; null otherwise (the map then draws the fading outline at lastCrackstoneSighting). */
  marker: { x: number; z: number; yaw: number; coneDeg: number; kind: CrackMarkerKind } | null;
  /** PUBLIC telegraph (R9): the curse circle and its wind-up. */
  curse: { x: number; z: number; radiusM: number; startedAt: number; landsAt: number } | null;
  /** The scan ring around him — ONLY while his marker is allowed (else the ring would give his position away). */
  scan: { x: number; z: number; radiusM: number; startedAt: number; pulseAt: number; phase: 'warning' | 'pulse' } | null;
  /** He is chasing / cursing (the minimap's double crack ring; his MODE is public like the Hyde's). */
  chase: boolean;
  /** Sim t of the area announcement (label promoted for 30 s), null before. */
  announcedAt: number | null;
}

export function crackMapState(c: CrackHandle, fx: Pick<ActiveEffects, 'enemiesRevealed' | 'enemyRevealRangeM'>, player: Vec2, announcedAt: number | null): CrackMapState {
  const rt = c.rt;
  const kind = crackMarkerKind(c, fx, player);
  const marker = kind ? { x: rt.x, z: rt.z, yaw: rt.yaw, coneDeg: c.tuning.coneDeg, kind } : null;
  const active = c.active();
  return {
    area: c.area,
    marker,
    curse: active && rt.curse ? { ...rt.curse } : null,
    scan: marker && rt.scan ? { x: rt.x, z: rt.z, radiusM: rt.scan.radiusM, startedAt: rt.scan.startedAt, pulseAt: rt.scan.pulseAt, phase: rt.scan.phase } : null,
    chase: active && (rt.mode === 'CHASE' || rt.mode === 'ATTACK'),
    announcedAt,
  };
}

// ------------------------------------------------------------------------------------------------- status plaque

export type CrackPillKey = 'PATROL' | 'SEES' | 'INVESTIGATE' | 'SEARCH' | 'CHASE' | 'ATTACK' | 'RETURN' | 'SCAN';

export const CRACK_THREAT: Record<CrackPillKey, { word: string; icon: IconName }> = {
  PATROL: { word: 'Patrolling', icon: 'eye' },
  SEES: { word: 'SEES YOU', icon: 'eye' },
  INVESTIGATE: { word: 'Saw movement', icon: 'eye' },
  SEARCH: { word: 'Searching', icon: 'search' },
  CHASE: { word: 'HUNTING YOU', icon: 'hat' },
  ATTACK: { word: 'CURSING', icon: 'curse' },
  RETURN: { word: 'Going back', icon: 'reset' },
  SCAN: { word: 'Scanning', icon: 'scanEye' },
};

/** §1: CHASE / ATTACK first, then a pending scan warning (any mode), then "SEES YOU", else his mode. */
export function crackPillKey(rt: Pick<CrackstoneRuntime, 'mode' | 'canSeePlayer' | 'scan'>): CrackPillKey {
  if (rt.mode === 'CHASE' || rt.mode === 'ATTACK') return rt.mode;
  if (rt.scan?.phase === 'warning') return 'SCAN';
  if (rt.canSeePlayer) return 'SEES';
  return rt.mode;
}

/** Holds the shown state ≥ 0.5 s (no flicker); CHASE and ATTACK bypass the hold. */
export class CrackThreatHold {
  shown: CrackPillKey = 'PATROL';
  private since = -Infinity;
  constructor(private readonly holdS = 0.5) {}
  update(key: CrackPillKey, now: number): CrackPillKey {
    if (key !== this.shown && (now - this.since >= this.holdS || key === 'CHASE' || key === 'ATTACK')) {
      this.shown = key;
      this.since = now;
    }
    return this.shown;
  }
}

export interface CrackHudView {
  key: CrackPillKey;
  word: string;
  icon: IconName;
  /** suspicion / chaseAt, 0..1 (segmented underline). */
  meter: number;
  effect: { word: string; leftS: number | null } | null;
  /** He chases or curses (assertive live region, double border). */
  hunting: boolean;
}

export function crackEffectChip(c: CrackHandle, fx: Pick<ActiveEffects, 'crackstonePetrified' | 'crackstoneStunned' | 'crackstoneSlowed' | 'crackstoneDistracted'>, t: number): CrackHudView['effect'] {
  const rt = c.rt;
  const left = (until: number) => (until > t ? Math.round((until - t) * 10) / 10 : null);
  if (fx.crackstonePetrified) return { word: c.visual() === 'pin' ? 'PINNED' : 'PETRIFIED', leftS: left(Math.max(rt.stunnedUntil, rt.slowedUntil)) };
  if (fx.crackstoneStunned) return { word: 'STUNNED', leftS: left(rt.stunnedUntil) };
  if (fx.crackstoneSlowed) return { word: 'SLOWED', leftS: left(rt.slowedUntil) };
  if (fx.crackstoneDistracted) return { word: 'DISTRACTED', leftS: left(rt.distractedUntil) };
  if (c.lured(t)) return { word: 'LURED', leftS: null };
  return null;
}

export function crackHudView(c: CrackHandle, shown: CrackPillKey, fx: Parameters<typeof crackEffectChip>[1], t: number): CrackHudView {
  const th = CRACK_THREAT[shown];
  return {
    key: shown, word: th.word, icon: th.icon,
    meter: Math.max(0, Math.min(1, c.rt.suspicion / c.tuning.chaseAt)),
    effect: crackEffectChip(c, fx, t),
    hunting: shown === 'CHASE' || shown === 'ATTACK',
  };
}

// ------------------------------------------------------------------------------------------------- telegraph banner

export type BannerKind = 'scan' | 'scan_hit' | 'scan_miss' | 'curse' | 'curse_hit' | 'curse_blocked' | 'curse_miss';

export interface BannerView {
  /** Result banners count up (the curse-hit flash keys on it); pending countdowns are 0. */
  id: number;
  kind: BannerKind;
  /** Line 1 (caps, bold), e.g. "SCAN IN 1.6 s". */
  head: string;
  /** Line 2 (fs-xs) or null. */
  text: string | null;
  /** Visual tone: 'danger' = 3px double crack, 'calm' = dashed muted, 'good' = success, 'muted' = result / miss. */
  tone: 'danger' | 'calm' | 'good' | 'muted';
  icon: IconName;
  /** Countdown left (s, one decimal) for scan / curse; null for results. */
  leftS: number | null;
  /** Depleting bar 1 → 0 (null = no bar). */
  frac: number | null;
  exposure: Exposure | null;
}

export const SCAN_HIT_S = 1.2;
export const SCAN_MISS_S = 1.0;
export const CURSE_HIT_S = 1.5;
export const CURSE_MISS_S = 1.0;
export const CURSE_BLOCKED_S = 1.5;

const fmt1 = (s: number) => Math.max(0, s).toFixed(1);

/** Copy of the pending-scan banner (§2 table). */
export function scanCopy(exposure: Exposure, leftS: number): Pick<BannerView, 'head' | 'text' | 'tone'> {
  const head = `SCAN IN ${fmt1(leftS)} s`;
  if (exposure === 'exposed') return { head, text: 'Get behind a wall or hide. Crouching won’t help.', tone: 'danger' };
  if (exposure === 'covered') return { head, text: 'You’re covered. Stay put.', tone: 'calm' };
  return { head, text: 'You’re clear. Keep moving.', tone: 'calm' };
}

/** Copy of the pending-curse banner. */
export function curseCopy(exposure: Exposure, leftS: number): Pick<BannerView, 'head' | 'text' | 'tone'> {
  const head = `CURSE IN ${fmt1(leftS)} s`;
  if (exposure === 'exposed') return { head, text: 'Step out of the ring!', tone: 'danger' };
  return { head, text: 'You’re clear. Keep moving.', tone: 'calm' };
}

export interface TelegraphOutput {
  banner: BannerView | null;
  /** Remaining seconds of the curse slow (Vitals CURSED row), null when not cursed. */
  cursedLeftS: number | null;
  /** Assertive screen-reader lines to speak now (each once). */
  announce: string[];
  /** One-time log line ("Walls and hiding spots block scans."), null otherwise. */
  log: string | null;
}

/**
 * Turns the public telegraphs + this frame's events into ONE banner (curse > scan; results after the countdown), the
 * CURSED row and the once-only screen reader lines. `now` = real seconds (result banner durations), `t` = sim seconds.
 */
export class TelegraphTracker {
  private result: { view: BannerView; until: number; curse: boolean } | null = null;
  private scanShown: number | null = null; // startedAt of the scan whose banner was shown
  private scanSaid: number | null = null;
  private curseSaid: number | null = null;
  private firstMissLogged = false;
  private cursedUntilT = -Infinity;

  update(c: CrackHandle, events: readonly GameEvent[], fx: Pick<ActiveEffects, 'cursed'>, t: number, now: number): TelegraphOutput {
    const announce: string[] = [];
    let log: string | null = null;
    const rt = c.rt;
    for (const e of events) {
      if (e.type === 'crackstone_scan' && e.phase === 'pulse') {
        if (e.hit) this.setResult({ kind: 'scan_hit', head: 'SEEN BY THE SCAN', text: null, tone: 'danger', icon: 'scanEye', leftS: null, frac: null, exposure: 'exposed' }, now + SCAN_HIT_S, false);
        else if (this.scanShown !== null) {
          this.setResult({ kind: 'scan_miss', head: 'Scan passed. Unseen.', text: null, tone: 'muted', icon: 'scanEye', leftS: null, frac: null, exposure: null }, now + SCAN_MISS_S, false);
          if (!this.firstMissLogged) {
            this.firstMissLogged = true;
            log = 'Walls and hiding spots block scans.';
          }
        }
        this.scanShown = null;
      } else if (e.type === 'curse' && e.phase === 'hit') {
        if (e.blocked) this.setResult({ kind: 'curse_blocked', head: 'CURSE BLOCKED', text: 'No damage.', tone: 'good', icon: 'shieldCheck', leftS: null, frac: null, exposure: null }, now + CURSE_BLOCKED_S, true);
        else {
          this.cursedUntilT = t + c.tuning.curseSlowS;
          const slow = c.tuning.curseSlowS;
          this.setResult({ kind: 'curse_hit', head: `CURSED −${Math.round(e.hpLost)} HP`, text: slow > 0 ? `Slowed for ${fmtS(slow)} s` : null, tone: 'danger', icon: 'curse', leftS: null, frac: null, exposure: 'exposed' }, now + CURSE_HIT_S, true);
        }
      } else if (e.type === 'curse' && e.phase === 'miss') {
        this.setResult({ kind: 'curse_miss', head: 'Curse missed', text: null, tone: 'muted', icon: 'curse', leftS: null, frac: null, exposure: null }, now + CURSE_MISS_S, true);
      }
    }
    if (this.result && now >= this.result.until) this.result = null;

    let banner: BannerView | null = null;
    // ---- curse (highest priority): pending circle, else its result
    const cu = c.active() ? rt.curse : null;
    if (cu) {
      const exposure = c.curseExposure() ?? 'out';
      const leftS = Math.max(0, cu.landsAt - t);
      const total = Math.max(1e-6, cu.landsAt - cu.startedAt);
      banner = { id: 0, kind: 'curse', ...curseCopy(exposure, leftS), icon: 'curse', leftS: round1(leftS), frac: Math.max(0, Math.min(1, leftS / total)), exposure };
      if (exposure === 'exposed' && this.curseSaid !== cu.startedAt) {
        this.curseSaid = cu.startedAt;
        announce.push('Curse! Leave the ring.');
      }
    } else if (this.result?.curse) banner = this.result.view;
    // ---- scan: pending warning (shown once the player is in range), else its result
    if (!banner) {
      const sc = c.active() && rt.scan?.phase === 'warning' ? rt.scan : null;
      if (sc) {
        const exposure = c.scanExposure() ?? 'out';
        if (exposure !== 'out') this.scanShown = sc.startedAt;
        if (this.scanShown === sc.startedAt) {
          const leftS = Math.max(0, sc.pulseAt - t);
          const total = Math.max(1e-6, sc.pulseAt - sc.startedAt);
          banner = { id: 0, kind: 'scan', ...scanCopy(exposure, leftS), icon: 'scanEye', leftS: round1(leftS), frac: Math.max(0, Math.min(1, leftS / total)), exposure };
        }
        if (exposure === 'exposed' && this.scanSaid !== sc.startedAt) {
          this.scanSaid = sc.startedAt;
          announce.push(`Crackstone scan in ${Math.max(1, Math.round(Math.max(0, sc.pulseAt - t)))} seconds. Get behind a wall or hide.`);
        }
      } else if (this.result && !this.result.curse) banner = this.result.view;
    }
    const cursedLeftS = fx.cursed ? Math.max(0, round1(this.cursedUntilT - t)) : null;
    return { banner, cursedLeftS, announce, log };
  }

  private seq = 0;
  private setResult(view: Omit<BannerView, 'id'>, until: number, curse: boolean): void {
    // a curse result never yields to a scan result arriving in the same window
    if (this.result?.curse && !curse && this.result.until > until - 0.01) return;
    this.result = { view: { ...view, id: ++this.seq }, until, curse };
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const fmtS = (s: number) => (Number.isInteger(s) ? String(s) : s.toFixed(1));

// ------------------------------------------------------------------------------------------------- ThingStack

export const CRACK_HEAD = 'CRACKSTONE';
export const CRACK_P5_GAP_S = 20;
export const ALERT_CODE_GAP_S = 45;
export const ALERTS_PER_MIN = 4;

/** Stable code of a message id ("crack_chase_saw_412" → "crack_chase_saw"). */
export function codeOf(id: string): string {
  return id.replace(/([_:-]v?\d+(\.\d+)?)+$/, '');
}

/**
 * §6 rate limits for Crackstone stack items: a Crackstone P5 at most once per 20 s, the same code ≥ 45 s apart, and
 * Hyde + Crackstone alerts together ≤ 4 per minute (Hyde alerts are counted, never dropped here).
 */
export class AlertLimiter {
  private alerts: number[] = [];
  private lastCrackP5 = -Infinity;
  private codeAt = new Map<string, number>();

  allow(item: { id: string; head: string; priority: number }, now: number): boolean {
    this.alerts = this.alerts.filter((t) => now - t < 60);
    const crack = item.head === CRACK_HEAD;
    const alert = item.priority >= 5 && (crack || item.head === 'HYDE ALERT');
    if (!crack) {
      if (alert) this.alerts.push(now);
      return true;
    }
    const code = codeOf(item.id);
    const lastCode = this.codeAt.get(code);
    if (lastCode !== undefined && now - lastCode < ALERT_CODE_GAP_S) return false;
    if (item.priority >= 5) {
      if (now - this.lastCrackP5 < CRACK_P5_GAP_S) return false;
      if (this.alerts.length >= ALERTS_PER_MIN) return false;
      this.lastCrackP5 = now;
      this.alerts.push(now);
    }
    this.codeAt.set(code, now);
    return true;
  }
}

/** WHY copy for the start of an encounter (rule-verified: the mode reason says how he found you). */
export const CHASE_WHY: Partial<Record<string, string>> = {
  saw_player: 'He saw you in the open. Break line of sight!',
  sensed_player: 'You got too close. He sensed you. Run!',
  scan_hit: 'The scan found you in the open. Get away!',
};

/** Escape WHY by the reason he gave up (CHASE → SEARCH). */
export const ESCAPE_WHY: Partial<Record<string, string>> = {
  lost_sight: 'Lost him: a wall broke his line of sight.',
  leash: 'Lost him: he won’t leave his haunt.',
};

/** True when a mode change starts a new encounter (not his own curse → chase, not a deferral). */
export function encounterStart(e: Extract<GameEvent, { type: 'crackstone_mode' }>): boolean {
  return e.to === 'CHASE' && e.from !== 'ATTACK' && (e.reason === 'saw_player' || e.reason === 'sensed_player' || e.reason === 'scan_hit');
}

/** Spectator chip word (≤ 100 px). */
export const CRACK_CHIP: Record<CrackstoneMode, { word: string; icon: IconName }> = {
  PATROL: { word: 'Patrol', icon: 'eye' },
  INVESTIGATE: { word: 'Glimpse', icon: 'eye' },
  CHASE: { word: 'HUNTING', icon: 'hat' },
  ATTACK: { word: 'CURSING', icon: 'curse' },
  SEARCH: { word: 'Search', icon: 'search' },
  RETURN: { word: 'Return', icon: 'reset' },
};

/**
 * Curse circle edge cue: the centre is off-screen (|bearing| > 40°, or under the first-person camera within 1.5 m) AND
 * the player is inside or within 2 m of the rim.
 */
export function curseEdgeWanted(curse: { x: number; z: number; radiusM: number }, player: Vec2, relBearingDeg: number): boolean {
  const d = Math.hypot(curse.x - player.x, curse.z - player.z);
  return d <= curse.radiusM + 2 && (d < 1.5 || Math.abs(relBearingDeg) > 40);
}

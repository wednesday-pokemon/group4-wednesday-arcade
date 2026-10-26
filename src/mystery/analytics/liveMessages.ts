// Live DESCRIPTIVE (Thing's Log) and DIAGNOSTIC (WHY) messages from the event stream, with the UX rate limits
// (docs/overhaul/UX_OVERHAUL.md §6, rulings R2/R6). Pure: the engine feeds events in order plus a small context of
// PUBLIC facts (names, the player's current stance, hazards of the case world, clue mentions).
//
// Diagnostic basis:
//   rule    — a direct game-rule cause read from the recorded transition: `hyde_mode … heard_noise` + the `hyde_heard`
//             source at that instant + the stance / floor at the noise position; `saw_player` → CHASE; `stunned` /
//             `lured` reasons; a chase lost within 5 s of the player's own lure / distract / stun; a chase lost while
//             hidden; `egg_damage` / `egg_drop` causes; `hazard_triggered`; a clue that names suspects (public mentions).
//   pattern — a labelled co-occurrence count ("2 of 3 alerts came while sprinting. Not proof."), ≤ 1 per run, never
//             during a threat.
// INVESTIGATION never names a suspect (R2) and never uses the answer key: it only says how many suspects the clue names.
//
// Limits: log ≤ 34 chars, ≥ 2.5 s apart (latest wins); diagnostic headword ≤ 13, body ≤ 48, ≥ 8 s apart (P5 exempt),
// the same code ≥ 45 s apart, ≤ 3 per minute (P5 exempt), a waiting diagnostic older than 4 s is dropped.
//
// Joseph Crackstone (UX_ENEMIES §6, headword CRACKSTONE): chase start by sight / proximity / scan (P5, with the rule
// cause: distance, stance, in the open), curse hit (P5), escapes and dodged / blocked curses (P3, WHY from the public
// facts of that frame: hidden, a wall between the player and his last public position, out of his leash disc, out of
// his sight range, outside the curse ring), a scan the walls / hiding blocked (P3, once), his stun / lure by the
// player's own ability (POWER STATUS), the escape count (LOG). Scan / curse WARNINGS never enter the stream (the HUD
// banners own them) and a `deferred` mode change says nothing. Extra limits: a CRACKSTONE P5 at most 1 per 20 s and
// never pre-empts a waiting HYDE ALERT (it waits behind it); HYDE ALERT + CRACKSTONE items at most 4 per minute.
import type { AbilityEffectKind, CrackstoneDetectVia, CrackstoneMode, EnemyId, HazardDef, HydeMode, NoiseSource, SlurpMode, Stance, StampedEvent, Vec2 } from '../types.ts';
import type { CrackFrameFacts } from './crackstoneLive.ts';
import { pointInPolygon } from '../geometry.ts';
import type { LiveMessage } from './types.ts';

export const LOG_MAX = 34;
export const DIAG_MAX = 48;
export const ADVICE_MAX = 52;
export const WHY_MAX = 48;
export const LOG_GAP_S = 2.5;
export const DIAG_GAP_S = 8;
export const DIAG_SAME_CODE_S = 45;
export const DIAG_PER_MINUTE = 3;
export const DIAG_MAX_WAIT_S = 4;
/** UX_ENEMIES §6: a Crackstone P5 at most once per 20 s; Hyde + Crackstone alerts at most 4 per minute. */
export const CRACK_P5_GAP_S = 20;
export const ENEMY_ALERTS_PER_MINUTE = 4;

export const TITLES = {
  log: "THING'S LOG",
  hyde: 'HYDE ALERT',
  crackstone: 'CRACKSTONE',
  power: 'POWER STATUS',
  egg: 'EGG STATUS',
  investigation: 'INVESTIGATION',
  pattern: 'PATTERN',
  advice: "THING'S ADVICE",
  slurp: 'SLURP',
  weems: 'PRINCIPAL WEEMS',
} as const;

/** Headword of each enemy's alerts / WHY messages. */
export const ENEMY_TITLE: Readonly<Record<EnemyId, string>> = { hyde: TITLES.hyde, crackstone: TITLES.crackstone, slurp: TITLES.slurp };

/** Thing's log lines for the director's spawns / despawns (≤ 34 chars; presence only, never a position). */
export const LIFECYCLE_LOG: Readonly<Record<EnemyId, { spawned: string; despawned: string }>> = {
  hyde: { spawned: 'The Hyde is on the prowl.', despawned: 'The Hyde slunk away.' },
  crackstone: { spawned: 'Crackstone walks again.', despawned: 'Crackstone faded away.' },
  slurp: { spawned: 'Slurp is shambling about.', despawned: 'Slurp shambled off.' },
};

/** UX §6 priority levels. */
export const P = { log: 0, investigation: 1, routineAdvice: 2, why: 3, threatAdvice: 4, alert: 5 } as const;

export interface MessageCandidate {
  kind: 'log' | 'diagnostic';
  code: string;
  title: string;
  text: string;
  basis?: 'rule' | 'pattern';
  priority: number;
  t: number;
  /** Optional token the board can render without free text (an ability id). */
  ref?: string | null;
}

/** A released message with its stable code (also the id prefix) and token reference. */
export interface Released { msg: LiveMessage; code: string; ref: string | null }

export interface MessageContext {
  /** "<partner>'s <move>" / "<character>'s <power>" (or the ability name alone when that is too long). */
  abilityLabel(key: 'F' | 'Q', abilityId: string): string;
  hazards: readonly HazardDef[];
  /** Number of suspects a clue's public text names (ClueDef.mentions). */
  mentions(clueId: string): number;
  clueTotal: number;
  passageName?: string;
}

function fit(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

const FLOOR_TEXT: Record<string, string> = {
  glass: 'The broken glass crunched under you.',
  boards: 'The floorboards creaked under you.',
  rubble: 'The rubble shifted under you.',
  puddle: 'Splashing through water was heard.',
};

const ESCAPE_KINDS: readonly AbilityEffectKind[] = ['lure', 'distract', 'stun'];

/** Codes that describe the hit itself (the game-over WHY's first line says that part). */
const HIT_CODES = /^(caught_\d|slurp_hit|hit_blocked|crack_curse_hit|crack_curse_blocked)$/;

type DiagFn = (code: string, title: string, text: string, priority: number, basis?: 'rule' | 'pattern', ref?: string | null) => void;

/** "{Name}" as UX_FINAL §8 writes it: The Hyde / Crackstone / Slurp. */
export const WHO: Readonly<Record<EnemyId, string>> = { hyde: 'The Hyde', crackstone: 'Crackstone', slurp: 'Slurp' };

function enemyOfTitle(title: string): EnemyId | null {
  return title === TITLES.hyde ? 'hyde' : title === TITLES.crackstone ? 'crackstone' : title === TITLES.slurp ? 'slurp' : null;
}

/** Mutable per-session state of the rules (stance, chase, last ability, counts). */
export class EventRules {
  stance: Stance;
  hidden = false;
  escapes = 0;
  catches = 0;
  chases = 0;
  alerts = 0;
  alertsWhileSprinting = 0;
  alertsWhileCarrying = 0;
  carrying = false;
  private lastNoise: { t: number; source: NoiseSource; x: number; z: number } | null = null;
  private lastHeard: { t: number; source: NoiseSource; distanceM: number } | null = null;
  private lastAbility: { t: number; key: 'F' | 'Q'; abilityId: string; kinds: AbilityEffectKind[]; success: boolean } | null = null;
  private lastSighting: { t: number; distanceM: number } | null = null;
  // ---- Joseph Crackstone
  crackChases = 0;
  crackEscapes = 0;
  private crackSighting: { t: number; via: CrackstoneDetectVia; distanceM: number } | null = null;
  private crackScanExplained = false;
  // ---- final: director / Slurp / cabinets / rule-event counts
  slurpChases = 0;
  slurpEscapes = 0;
  /** Exact counts of the scoring RULE events (enemy_detected / enemy_hit / hint_requested). */
  detections: Record<EnemyId, number> = { hyde: 0, crackstone: 0, slurp: 0 };
  hits: Record<EnemyId, number> = { hyde: 0, crackstone: 0, slurp: 0 };
  blockedHits = 0;
  hintsUsed = 0;
  private lastCabinet: { t: number; action: string; loud: boolean } | null = null;
  private lastBlock: { t: number; key: 'F' | 'Q'; abilityId: string } | null = null;
  private emergedAt: number | null = null;
  private readonly spawnedOnce = new Set<EnemyId>();
  private witness: { enemy: EnemyId; t: number } | null = null;
  private cabinetClosed = false;
  private creakAt: number | null = null;
  /** The newest RULE cause that is not the hit itself (diagnostic text) — the game-over WHY's second line. */
  lastCause: { t: number; text: string; code: string; enemy: EnemyId | null } | null = null;
  /** The newest such cause per enemy (the game-over WHY prefers the monster that ended the run). */
  lastCauseBy: Partial<Record<EnemyId, { t: number; text: string; code: string; enemy: EnemyId | null }>> = {};

  constructor(private readonly ctx: MessageContext, initialStance: Stance = 'idle') {
    this.stance = initialStance;
  }

  private floorAt(pos: Vec2 | null): string | null {
    if (!pos) return null;
    for (const h of this.ctx.hazards) {
      if (h.kind === 'noisy_floor' && pointInPolygon(pos.x, pos.z, h.polygon)) return FLOOR_TEXT[h.look] ?? null;
    }
    return null;
  }

  /** Candidates produced by one event (in order). `hidden` = the player's hiding state at this frame. */
  onEvent(e: StampedEvent, hidden: boolean, crack: CrackFrameFacts | null = null): MessageCandidate[] {
    const out: MessageCandidate[] = [];
    const t = e.t;
    const diag = (code: string, title: string, text: string, priority: number, basis: 'rule' | 'pattern' = 'rule', ref: string | null = null) => {
      out.push({ kind: 'diagnostic', code, title, text: fit(text, DIAG_MAX), basis, priority, t, ref });
      if (basis === 'rule' && title !== TITLES.investigation && !HIT_CODES.test(code)) {
        const enemy = enemyOfTitle(title);
        this.lastCause = { t, text: fit(text, DIAG_MAX), code, enemy };
        if (enemy) this.lastCauseBy[enemy] = this.lastCause;
      }
    };
    const log = (code: string, text: string) => out.push({ kind: 'log', code, title: TITLES.log, text: fit(text, LOG_MAX), priority: P.log, t });
    this.hidden = hidden;
    switch (e.type) {
      case 'stance':
        this.stance = e.stance;
        break;
      case 'noise':
        this.lastNoise = { t, source: e.source, x: e.x, z: e.z };
        if (this.cabinetClosed && e.source !== 'decoy' && !(this.lastCabinet && Math.abs(this.lastCabinet.t - t) < 0.05)) this.creakAt = t;
        break;
      case 'hyde_heard':
        this.lastHeard = { t, source: e.source, distanceM: e.distanceM };
        break;
      case 'hyde_sighted':
        this.lastSighting = { t, distanceM: e.distanceM };
        break;
      case 'ability_used':
        this.lastAbility = { t, key: e.key, abilityId: e.abilityId, kinds: [...e.kinds], success: e.success };
        if (e.success && e.kinds.includes('block_grab')) this.lastBlock = { t, key: e.key, abilityId: e.abilityId };
        break;
      case 'hyde_emerged':
        this.emergedAt = t;
        log('hyde_emerged', 'The Hyde has emerged.');
        break;
      case 'hint_requested':
        this.hintsUsed++;
        break;
      case 'enemy_spawned':
        // the first Hyde spawn is announced by hyde_emerged ("The Hyde has emerged.") when the sim emits it
        if (!(e.enemy === 'hyde' && this.emergedAt !== null && Math.abs(this.emergedAt - t) < 0.05 && !this.spawnedOnce.has('hyde'))) {
          log(`spawn_${e.enemy}`, LIFECYCLE_LOG[e.enemy].spawned);
        }
        this.spawnedOnce.add(e.enemy);
        break;
      case 'enemy_despawned':
        log(`despawn_${e.enemy}`, LIFECYCLE_LOG[e.enemy].despawned);
        break;
      case 'enemy_detected':
        this.detections[e.enemy]++;
        this.detected(e.enemy, e.via, t, diag);
        break;
      case 'enemy_hit':
        this.hits[e.enemy]++;
        if (e.blocked) this.blockedHits++;
        if (e.enemy === 'slurp') {
          if (e.blocked) diag('hit_blocked', TITLES.slurp, this.blockText('attack'), P.alert, 'rule', this.lastBlock?.abilityId ?? null);
          else diag('slurp_hit', TITLES.slurp, `Slurp's lunge hit you. −${Math.round(e.hpLost)} HP.`, P.alert);
        }
        break;
      case 'cabinet':
        this.lastCabinet = { t, action: e.action, loud: e.loud };
        if (e.action === 'close') this.cabinetClosed = true;
        else if (e.action !== 'enter') this.cabinetClosed = false;
        if (e.action === 'pulled_out') {
          const who = this.witness?.enemy ?? 'hyde';
          diag('pulled_out', ENEMY_TITLE[who], `${WHO[who]} saw you hide and pulled you out.`, P.alert);
          this.witness = null;
        }
        break;
      case 'slurp_mode':
        this.slurpMode(t, e.from, e.to, e.reason, diag, log);
        break;
      case 'hyde_mode': {
        const alertNow = e.to === 'INVESTIGATE_SOUND' || e.to === 'SEARCH' || e.to === 'CHASE';
        if (alertNow && e.from !== 'CHASE' && (e.reason === 'heard_noise' || e.reason === 'saw_player')) {
          this.alerts++;
          if (this.stance === 'sprint') this.alertsWhileSprinting++;
          if (this.carrying) this.alertsWhileCarrying++;
        }
        if (e.to === 'INVESTIGATE_SOUND' && e.reason === 'heard_noise') {
          const heard = this.lastHeard && this.lastHeard.t === t ? this.lastHeard : null;
          if (this.creakNow(t)) diag('cabinet_creak', TITLES.hyde, 'The cabinet door creaked.', P.why);
          else if (this.cabinetLoudAt(t)) diag('noise_cabinet', TITLES.hyde, 'The Hyde heard the cabinet door.', P.why);
          else if (heard) this.noiseCause(heard.source, t, diag);
        } else if (e.to === 'CHASE' && e.reason === 'saw_player') {
          this.chases++;
          const d = this.lastSighting ? Math.round(this.lastSighting.distanceM) : null;
          const text = this.stance === 'sprint' ? 'It spotted you sprinting in the open.'
            : this.stance === 'crouch' ? `It saw you even crouched${d !== null ? `, ${d} m away` : ''}.`
            : `It spotted you${d !== null ? ` ${d} m away` : ''}. Break its sight!`;
          diag('seen', TITLES.hyde, text, P.alert);
        } else if (e.to === 'CHASE') {
          this.chases++;
        }
        if (e.reason === 'stunned' && this.recentAbility(t, 0.05)) {
          diag('power_stun', TITLES.power, `${this.ctx.abilityLabel(this.lastAbility!.key, this.lastAbility!.abilityId)} stunned the Hyde.`, P.why, 'rule', this.lastAbility!.abilityId);
        } else if (e.reason === 'lured' && this.recentAbility(t, 0.05)) {
          diag('power_lure', TITLES.power, `${this.ctx.abilityLabel(this.lastAbility!.key, this.lastAbility!.abilityId)} lured the Hyde away.`, P.why, 'rule', this.lastAbility!.abilityId);
        }
        if (e.from === 'CHASE' && e.to !== 'CHASE' && e.reason !== 'grabbed') {
          // the chase ended without a catch: an escape
          this.escapes++;
          log('escape', `Hyde lost you. Escapes: ${this.escapes}.`);
          const ab = this.lastAbility;
          if (e.reason !== 'stunned' && e.reason !== 'lured' && ab && ab.success && t - ab.t <= 5 && ab.kinds.some((k) => ESCAPE_KINDS.includes(k))) {
            diag('power_escape', TITLES.power, `${this.ctx.abilityLabel(ab.key, ab.abilityId)} helped you escape.`, P.why, 'rule', ab.abilityId);
          } else if (e.reason === 'lost_sight' && this.hidden) {
            diag('hidden_escape', TITLES.hyde, 'Hiding broke its line of sight.', P.why);
          }
        }
        break;
      }
      case 'catch':
        this.catches++;
        diag(`caught_${e.catchNumber}`, TITLES.hyde, e.blocked
          ? (this.lastBlock?.key === 'Q' ? `Caught ${e.catchNumber} of 2. Your Pokémon blocked it.` : `Caught ${e.catchNumber} of 2. The block saved your HP.`)
          : `Caught ${e.catchNumber} of 2: it reached you. −${e.hpLost} HP.`, P.alert);
        break;
      case 'crackstone_sighted':
        this.crackSighting = { t, via: e.via, distanceM: e.distanceM };
        break;
      case 'crackstone_lost':
        this.crackSighting = null;
        break;
      case 'crackstone_mode':
        this.crackMode(e.t, e.from, e.to, e.reason, crack, diag, log);
        break;
      case 'crackstone_scan':
        if (e.phase === 'pulse' && !e.hit && !this.crackScanExplained && crack?.lastScanExposure === 'covered') {
          this.crackScanExplained = true;
          diag('crack_scan_covered', TITLES.crackstone, 'Walls and hiding spots block scans.', P.why);
        }
        break;
      case 'curse':
        if (e.phase === 'hit') {
          if (e.blocked) diag('crack_curse_blocked', TITLES.crackstone, this.lastBlock ? this.blockText('curse') : 'Your block stopped the curse. No damage.', P.why);
          else diag('crack_curse_hit', TITLES.crackstone, `The curse hit: you stayed in the ring. −${e.hpLost} HP.`, P.alert);
        } else if (e.phase === 'miss' && crack?.lastCurse && t >= crack.lastCurse.landsAt - 0.05) {
          // landed and missed (a cancelled curse is the stun / lure's story, said by POWER STATUS)
          if (crack.insideLastCurse === false) diag('crack_curse_dodged', TITLES.crackstone, 'Curse dodged: you left the ring in time.', P.why);
          else if (crack.hidden) diag('crack_curse_hidden', TITLES.crackstone, 'Hiding blocked the curse.', P.why);
          else diag('crack_curse_wall', TITLES.crackstone, 'A wall blocked his curse.', P.why);
        }
        break;
      case 'hazard_triggered': {
        const h = this.ctx.hazards.find((x) => x.id === e.hazardId);
        diag('searchlight', TITLES.hyde, h && h.kind === 'searchlight' ? 'The searchlight caught you.' : `${h?.name ?? 'A trap'} raised the alarm.`, P.why);
        break;
      }
      case 'clue_found': {
        log('clues', e.cluesFound >= this.ctx.clueTotal ? `All ${this.ctx.clueTotal} clues found.` : `${e.cluesFound} of ${this.ctx.clueTotal} clues found.`);
        const n = this.ctx.mentions(e.clueId);
        if (n > 0) diag('clue_statement', TITLES.investigation, n === 1 ? 'Names a suspect. Compare statements on Tab.' : `Names ${n} suspects. Compare statements on Tab.`, P.investigation);
        break;
      }
      case 'egg_pickup':
        this.carrying = true;
        log('egg_pickup', 'Egg picked up.');
        break;
      case 'egg_damage':
        if (e.cause === 'impact') diag('egg_impact', TITLES.egg, 'The egg was damaged after a collision.', P.why);
        else if (e.cause === 'grab') diag('egg_grab', TITLES.egg, `The grab cost the egg ${Math.round(e.amount)} security.`, P.why);
        break;
      case 'egg_drop':
        this.carrying = false;
        if (e.reason === 'impact') diag('egg_drop_impact', TITLES.egg, 'A hard collision knocked the egg loose.', P.why);
        else if (e.reason === 'grab') diag('egg_drop_grab', TITLES.egg, 'The grab knocked the egg loose.', P.why);
        break;
      case 'egg_delivered':
        this.carrying = false;
        log('egg_secured', 'Egg secured.'); // only once it is delivered at Iago Tower
        break;
      case 'passage_opened':
        log('passage', 'Hidden passage open.');
        break;
      case 'trace_found':
        log('trace', 'Egg trace found. Odds updated.');
        break;
      case 'site_checked':
        if (!e.found) log('site_empty', 'Not here. Odds updated.');
        break;
      default:
        break;
    }
    return out;
  }

  /** Crackstone mode changes: chase start (P5 rule cause), escapes (WHY + LOG), his stun / lure by the own ability. */
  private crackMode(
    t: number, from: CrackstoneMode, to: CrackstoneMode, reason: string, crack: CrackFrameFacts | null,
    diag: (code: string, title: string, text: string, priority: number, basis?: 'rule' | 'pattern', ref?: string | null) => void,
    log: (code: string, text: string) => void,
  ): void {
    if (reason === 'deferred') return; // he yielded to the Hyde's chase: nothing to say (UX §6)
    const engaged = (m: CrackstoneMode) => m === 'CHASE' || m === 'ATTACK';
    if (to === 'CHASE' && from !== 'ATTACK' && (reason === 'saw_player' || reason === 'sensed_player' || reason === 'scan_hit')) {
      this.crackChases++;
      this.alerts++;
      if (this.stance === 'sprint') this.alertsWhileSprinting++;
      if (this.carrying) this.alertsWhileCarrying++;
      const d = crack?.nowDistanceM != null ? Math.round(crack.nowDistanceM) : this.crackSighting ? Math.round(this.crackSighting.distanceM) : null;
      if (reason === 'sensed_player') {
        diag('crack_sensed', TITLES.crackstone, `Too close: he sensed you within ${crack ? crack.proximityM : 3} m. Run!`, P.alert);
      } else if (reason === 'scan_hit') {
        diag('crack_scan_hit', TITLES.crackstone, this.stance === 'crouch' ? 'The scan found you: crouching does not hide you.' : 'The scan found you: no wall between you. Hide!', P.alert);
      } else {
        void d; // the distance stays in the results panel (diagnostic.ts); the live line is the UX_FINAL §8 copy
        diag('crack_seen', TITLES.crackstone, this.crackSeenText(), P.alert);
      }
      return;
    }
    const ab = this.lastAbility;
    const own = ab !== null && this.recentAbility(t, 0.05);
    if (engaged(from) && !engaged(to) && reason !== 'curse_done') {
      this.crackEscapes++;
      log('crack_escape', `Crackstone lost you. Escapes: ${this.crackEscapes}.`);
      if ((reason === 'stunned' || reason === 'lured') && own && ab) {
        diag(reason === 'stunned' ? 'crack_power_stun' : 'crack_power_lure', TITLES.power,
          `${this.ctx.abilityLabel(ab.key, ab.abilityId)} ${reason === 'stunned' ? 'stopped' : 'lured'} Crackstone.`, P.why, 'rule', ab.abilityId);
        return;
      }
      if (reason === 'leash') {
        diag('crack_escape_leash', TITLES.crackstone, 'Lost him: you left his cursed area.', P.why);
      } else if (reason === 'lost_sight' || reason === 'curse_missed') {
        if (crack?.hidden) diag('crack_escape_hid', TITLES.crackstone, 'Lost him: hiding broke his line of sight.', P.why);
        else if (crack?.wallBetween) diag('crack_escape_wall', TITLES.crackstone, 'Lost him: a wall broke his line of sight.', P.why);
        else if (crack && crack.distanceToLastPoseM !== null && crack.distanceToLastPoseM > crack.sightRangeM) {
          diag('crack_escape_range', TITLES.crackstone, 'Lost him: you got out of his sight range.', P.why);
        }
      }
      return;
    }
    if ((reason === 'stunned' || reason === 'lured') && own && ab) {
      diag(reason === 'stunned' ? 'crack_power_stun' : 'crack_power_lure', TITLES.power,
        `${this.ctx.abilityLabel(ab.key, ab.abilityId)} ${reason === 'stunned' ? 'stopped' : 'lured'} Crackstone.`, P.why, 'rule', ab.abilityId);
    }
  }

  // ------------------------------------------------------------------------------------------------- final helpers

  private cabinetLoudAt(t: number): boolean {
    const c = this.lastCabinet;
    return c !== null && c.loud && t - c.t >= -1e-9 && t - c.t <= 0.1;
  }

  private creakNow(t: number): boolean {
    return this.creakAt !== null && t - this.creakAt >= -1e-9 && t - this.creakAt <= 0.1;
  }

  /** "Your Pokémon blocked the attack." when the consumed block came from the Pokémon's move (Q slot), else the power's name. */
  private blockText(what: 'attack' | 'curse'): string {
    const b = this.lastBlock;
    if (b?.key === 'Q') return `Your Pokémon blocked the ${what}.`;
    if (b?.key === 'F') return fit(`${this.ctx.abilityLabel('F', b.abilityId)} blocked the ${what}.`, DIAG_MAX);
    return `Your block stopped the ${what}.`;
  }

  /** enemy_detected (RULE event): the cause only when the event (and the same-instant hearing / stance) says so. */
  private detected(enemy: EnemyId, via: 'sight' | 'sound' | 'proximity' | 'scan' | 'witnessed_hide', t: number, diag: DiagFn): void {
    const title = ENEMY_TITLE[enemy];
    if (via === 'witnessed_hide') {
      this.witness = { enemy, t };
      diag(`witnessed_${enemy}`, title, 'Witnessed: it saw you hide.', P.alert);
      return;
    }
    if (enemy === 'hyde') {
      if (via === 'sound') {
        const heard = this.lastHeard && Math.abs(this.lastHeard.t - t) <= 0.1 ? this.lastHeard : null;
        if (this.creakNow(t)) diag('cabinet_creak', title, 'The cabinet door creaked.', P.alert);
        else if (this.cabinetLoudAt(t)) diag('noise_cabinet', title, 'The Hyde heard the cabinet door.', P.alert);
        else if (heard?.source === 'footstep') diag('det_hyde_steps', title, 'Hyde detected your footsteps.', P.alert);
        else if (heard) this.noiseCause(heard.source, t, (c, ti, tx, _p, b, r) => diag(c, ti, tx, P.alert, b, r));
      } else if (via === 'proximity') diag('det_hyde_near', title, 'Too close: the Hyde sensed you.', P.alert);
      // via sight: the hyde_mode → CHASE (saw_player) message says it with the distance
      return;
    }
    if (enemy === 'crackstone') {
      if (via === 'sight') diag('crack_seen', title, this.crackSeenText(), P.alert);
      // proximity / scan: the crackstone_mode message (crack_sensed / crack_scan_hit) carries the rule
      return;
    }
    if (via === 'sight') diag('slurp_seen', title, 'Slurp saw you and gave chase.', P.alert);
    else if (via === 'proximity') diag('slurp_sensed', title, 'Too close: Slurp sensed you. Run!', P.alert);
    else if (via === 'sound') this.slurpNoise(t, diag, P.alert);
  }

  private crackSeenText(): string {
    return this.stance === 'sprint' ? 'Crackstone spotted you sprinting.' : this.stance === 'crouch' ? 'Crackstone spotted you, even crouched.' : 'Crackstone spotted you.';
  }

  /** Why Slurp heard something (he hears only LOUD noises): a loud cabinet action, the creak, the egg, a sprint, an ability. */
  private slurpNoise(t: number, diag: DiagFn, priority: number): void {
    const title = TITLES.slurp;
    if (this.creakNow(t)) return diag('slurp_creak', title, 'The cabinet door creaked.', priority);
    if (this.cabinetLoudAt(t)) return diag('slurp_cabinet', title, 'Slurp heard the cabinet door.', priority);
    const n = this.lastNoise && Math.abs(this.lastNoise.t - t) <= 0.1 ? this.lastNoise : null;
    if (!n) return;
    if (n.source === 'egg_drop') return diag('slurp_egg', title, 'Slurp heard the egg hit the ground.', priority);
    if (n.source === 'footstep' && this.stance === 'sprint') return diag('slurp_sprint', title, 'Slurp heard you sprinting.', priority);
    if (n.source === 'ability') {
      return diag('slurp_ability', title, this.lastAbility ? `Slurp heard ${this.ctx.abilityLabel(this.lastAbility.key, this.lastAbility.abilityId)}.` : 'Slurp heard your ability.', priority, 'rule', this.lastAbility?.abilityId ?? null);
    }
    if (n.source === 'hazard') return diag('slurp_alarm', title, 'The alarm drew Slurp in.', priority);
    if (n.source === 'impact') return diag('slurp_impact', title, 'Slurp heard you crash into something.', priority);
  }

  /** Slurp's mode changes (slurp_mode events). */
  private slurpMode(t: number, from: SlurpMode, to: SlurpMode, reason: string, diag: DiagFn, log: (code: string, text: string) => void): void {
    if (reason === 'deferred') return;
    const engaged = (m: SlurpMode) => m === 'CHASE' || m === 'ATTACK';
    if (to === 'CHASE' && !engaged(from)) {
      this.slurpChases++;
      this.alerts++;
      if (this.stance === 'sprint') this.alertsWhileSprinting++;
      if (this.carrying) this.alertsWhileCarrying++;
      if (reason === 'saw_player') diag('slurp_seen', TITLES.slurp, 'Slurp saw you and gave chase.', P.alert);
      else if (reason === 'sensed_player') diag('slurp_sensed', TITLES.slurp, 'Too close: Slurp sensed you. Run!', P.alert);
      return;
    }
    if (to === 'INVESTIGATE' && reason === 'heard_noise') {
      this.slurpNoise(t, diag, P.why);
      return;
    }
    const ab = this.lastAbility;
    const own = ab !== null && this.recentAbility(t, 0.05);
    const power = (r: string) => diag(r === 'stunned' ? 'slurp_power_stun' : 'slurp_power_lure', TITLES.power,
      `${this.ctx.abilityLabel(ab!.key, ab!.abilityId)} ${r === 'stunned' ? 'stopped' : 'lured'} Slurp.`, P.why, 'rule', ab!.abilityId);
    if (engaged(from) && !engaged(to)) {
      if (reason === 'attack_done') return; // the hit itself is the story (enemy_hit)
      this.slurpEscapes++;
      log('slurp_escape', `Slurp lost you. Escapes: ${this.slurpEscapes}.`);
      if ((reason === 'stunned' || reason === 'lured') && own && ab) power(reason);
      else if (reason === 'lost_sight' && this.cabinetClosed) diag('slurp_escape_cabinet', TITLES.slurp, 'Lost Slurp: the cabinet door was shut.', P.why);
      else if (reason === 'lost_sight' && this.hidden) diag('slurp_escape_hid', TITLES.slurp, 'Lost Slurp: hiding broke his sight.', P.why);
      else if (reason === 'leash') diag('slurp_escape_leash', TITLES.slurp, 'Lost Slurp: you left his haunt.', P.why);
      return;
    }
    if ((reason === 'stunned' || reason === 'lured') && own && ab) power(reason);
  }

  /** Total RULE-event counts (scoring evidence: detections, hits, hints). */
  get detectionsTotal(): number {
    return this.detections.hyde + this.detections.crackstone + this.detections.slurp;
  }

  get hitsTotal(): number {
    return this.hits.hyde + this.hits.crackstone + this.hits.slurp;
  }

  private recentAbility(t: number, within: number): boolean {
    return this.lastAbility !== null && t - this.lastAbility.t <= within + 1e-9;
  }

  private noiseCause(source: NoiseSource, t: number, diag: (code: string, title: string, text: string, priority: number, basis?: 'rule' | 'pattern', ref?: string | null) => void): void {
    const pos = this.lastNoise && this.lastNoise.t === t && this.lastNoise.source === source ? { x: this.lastNoise.x, z: this.lastNoise.z } : null;
    switch (source) {
      case 'footstep': {
        const floor = this.floorAt(pos);
        if (floor && this.stance !== 'crouch') return diag('noise_floor', TITLES.hyde, floor, P.why);
        if (this.stance === 'sprint') return diag('noise_sprint', TITLES.hyde, 'Your sprinting made too much noise.', P.why);
        if (this.stance === 'crouch') return diag('noise_crouch', TITLES.hyde, 'Even crouched steps were heard up close.', P.why);
        return diag(this.carrying ? 'noise_carry' : 'noise_walk', TITLES.hyde, this.carrying ? 'Walking with the egg was heard.' : 'Your footsteps were heard.', P.why);
      }
      case 'egg_drop':
        return diag('noise_egg_drop', TITLES.hyde, 'The egg hitting the ground was heard.', P.why);
      case 'ability':
        return diag('noise_ability', TITLES.hyde, this.lastAbility ? `${this.ctx.abilityLabel(this.lastAbility.key, this.lastAbility.abilityId)} made noise.` : 'Your ability made noise.', P.why, 'rule', this.lastAbility?.abilityId ?? null);
      case 'interact':
        return diag('noise_search', TITLES.hyde, 'Searching made noise nearby.', P.why);
      case 'impact':
        return diag('noise_impact', TITLES.hyde, 'Bumping into something was heard.', P.why);
      case 'hazard':
        return diag('noise_alarm', TITLES.hyde, 'The searchlight alarm drew it in.', P.why);
      case 'decoy':
        return; // a decoy pulling it away is the lure's job (POWER STATUS)
    }
  }

  /**
   * The one labelled correlation of a run (≤ 1, never during a threat): alerts while sprinting / carrying.
   * Returns null when no pattern has enough support (≥ 3 alerts, ≥ 2 matching).
   */
  pattern(t: number): MessageCandidate | null {
    if (this.alerts < 3) return null;
    if (this.alertsWhileSprinting >= 2) {
      return { kind: 'diagnostic', code: 'pattern_sprint', title: TITLES.pattern, text: fit(`${this.alertsWhileSprinting} of ${this.alerts} alerts came while sprinting. Not proof.`, DIAG_MAX), basis: 'pattern', priority: P.investigation, t };
    }
    if (this.alertsWhileCarrying >= 2) {
      return { kind: 'diagnostic', code: 'pattern_carry', title: TITLES.pattern, text: fit(`${this.alertsWhileCarrying} of ${this.alerts} alerts came with the egg. Not proof.`, DIAG_MAX), basis: 'pattern', priority: P.investigation, t };
    }
    return null;
  }
}

/** Threat = the HUD shows the Hyde investigating, searching or chasing. */
export function isThreat(mode: HydeMode, emerged: boolean): boolean {
  return emerged && (mode === 'CHASE' || mode === 'INVESTIGATE_SOUND' || mode === 'SEARCH');
}

/** Slurp threat = the HUD shows him heard something / searching / chasing / grabbing. */
export function isSlurpThreat(mode: SlurpMode | null | undefined): boolean {
  return mode === 'CHASE' || mode === 'ATTACK' || mode === 'INVESTIGATE' || mode === 'SEARCH';
}

/** Crackstone threat = he is chasing or cursing (his position is public then, R4). */
export function isCrackThreat(mode: CrackstoneMode | null | undefined): boolean {
  return mode === 'CHASE' || mode === 'ATTACK';
}

const ENEMY_TITLES: ReadonlySet<string> = new Set([TITLES.hyde, TITLES.crackstone, TITLES.slurp]);

/** Rate limiter for the message stream (UX §6). Holds at most one waiting log and one waiting diagnostic. */
export class MessageGate {
  private lastLogT = -Infinity;
  private pendingLog: MessageCandidate | null = null;
  private lastDiagT = -Infinity;
  private diagTimes: number[] = [];
  private lastByCode = new Map<string, number>();
  private pendingDiag: MessageCandidate | null = null;
  /** A CRACKSTONE P5 waiting behind a HYDE ALERT (equal priority never pre-empts the Hyde). */
  private waitingCrack: MessageCandidate | null = null;
  private lastCrackP5T = -Infinity;
  private enemyTimes: number[] = [];
  private patternShown = false;
  private seq = 0;

  offer(c: MessageCandidate): void {
    if (c.kind === 'log') {
      this.pendingLog = c; // same type coalesces: the latest wins
      return;
    }
    const last = this.lastByCode.get(c.code);
    if (last !== undefined && c.t - last < DIAG_SAME_CODE_S) return;
    if (c.basis === 'pattern' && this.patternShown) return;
    const crackP5 = c.title === TITLES.crackstone && c.priority >= P.alert;
    if (crackP5 && c.t - this.lastCrackP5T < CRACK_P5_GAP_S) return;
    const pend = this.pendingDiag;
    if (crackP5 && pend && pend.title === TITLES.hyde && pend.priority >= P.alert) {
      this.waitingCrack = c; // waits behind the Hyde alert
      return;
    }
    if (pend && pend.title === TITLES.crackstone && pend.priority >= P.alert && c.title === TITLES.hyde && c.priority >= P.alert) {
      this.waitingCrack = pend; // the Hyde alert goes first; the Crackstone one keeps waiting
      this.pendingDiag = c;
      return;
    }
    if (!pend || c.priority >= pend.priority) this.pendingDiag = c;
  }

  get patternUsed(): boolean {
    return this.patternShown;
  }

  /** Messages released at time t. `threat` blocks patterns. */
  release(t: number, threat: boolean): Released[] {
    const out: Released[] = [];
    if (this.waitingCrack && t - this.waitingCrack.t > DIAG_MAX_WAIT_S) this.waitingCrack = null;
    if (!this.pendingDiag && this.waitingCrack) {
      this.pendingDiag = this.waitingCrack;
      this.waitingCrack = null;
    }
    const d = this.pendingDiag;
    if (d) {
      if (t - d.t > DIAG_MAX_WAIT_S || (d.basis === 'pattern' && threat)) this.pendingDiag = null; // stale, or a pattern during a threat
      else {
        this.diagTimes = this.diagTimes.filter((x) => t - x < 60);
        this.enemyTimes = this.enemyTimes.filter((x) => t - x < 60);
        const urgent = d.priority >= P.alert;
        const enemy = ENEMY_TITLES.has(d.title);
        const crackP5 = d.title === TITLES.crackstone && urgent;
        const gapOk = urgent || t - this.lastDiagT >= DIAG_GAP_S;
        const rateOk = (urgent || this.diagTimes.length < DIAG_PER_MINUTE) && (!enemy || this.enemyTimes.length < ENEMY_ALERTS_PER_MINUTE);
        const crackOk = !crackP5 || t - this.lastCrackP5T >= CRACK_P5_GAP_S;
        const last = this.lastByCode.get(d.code);
        const codeOk = last === undefined || t - last >= DIAG_SAME_CODE_S;
        if (!codeOk || !crackOk) this.pendingDiag = null;
        else if (gapOk && rateOk) {
          out.push({ msg: this.toMessage(d, 'diag'), code: d.code, ref: d.ref ?? null });
          this.lastDiagT = t;
          this.diagTimes.push(t);
          if (enemy) this.enemyTimes.push(t);
          if (crackP5) this.lastCrackP5T = t;
          this.lastByCode.set(d.code, t);
          if (d.basis === 'pattern') this.patternShown = true;
          this.pendingDiag = null;
        }
      }
    }
    const l = this.pendingLog;
    if (l && t - this.lastLogT >= LOG_GAP_S) {
      out.push({ msg: this.toMessage(l, 'log'), code: l.code, ref: null });
      this.lastLogT = t;
      this.pendingLog = null;
    }
    return out;
  }

  private toMessage(c: MessageCandidate, prefix: string): LiveMessage {
    this.seq++;
    return {
      id: `${prefix}:${c.code}:${c.t.toFixed(2)}:${this.seq}`, kind: c.kind, title: c.title, text: c.text,
      ...(c.basis ? { basis: c.basis } : {}), t: Math.round(c.t * 1000) / 1000, priority: c.priority,
      ...(enemyOfTitle(c.title) ? { enemy: enemyOfTitle(c.title)! } : {}),
    };
  }
}

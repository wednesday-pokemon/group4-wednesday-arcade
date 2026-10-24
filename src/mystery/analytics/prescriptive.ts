// PrescriptiveService — "What should be done?". An honest, deterministic RULE-BASED DECISION ENGINE (no reinforcement
// learning, no optimiser): it enumerates candidate actions from the live run state, keeps only the FEASIBLE ones, scores
// them by a fixed priority table and returns the best with a real reason taken from the state, plus alternatives.
//
// Overhaul (docs/overhaul/OVERHAUL_CONTRACT.md + UX_OVERHAUL.md R6): every search target comes from the PUBLIC view —
// the Bayesian clue-area / egg-site posteriors (bayes.ts) and the Hyde-zone estimate (hydeZones.ts) — never from the
// session's hidden placement (map.clues / map.eggSpawn / a resting egg's position / run.layout). Copy: action ≤ 52
// chars, why ≤ 48; ability keys are the PHYSICAL keys (ABILITY_KEY_LABEL: power Q, move R).
//
// Feasibility guarantees (tested over many bot states, for every duo):
//   • abilities: only the CURRENT duo's own power (run.power) / move (run.move), only when ready (not cooling), only when
//     relevant, and Hyde-targeted effects only when the sim's own targeting rule (range, line of sight, facing cone)
//     would accept them right now — never another character's power. Chosen by EFFECT KIND, never by id;
//   • clues: only uncollected ones, at sites whose posterior is > 0, in areas the nav graph can reach; hiding spots:
//     reachable, not toward the Hyde, not inside its reveal distance; routes: real nav paths;
//   • Hyde-relative advice only when the Hyde's whereabouts are public: it has emerged AND (the player sees it, it is
//     chasing, or the HUD shows it investigating / searching); otherwise only zone-level odds ("likely in …");
//   • never names a suspect and never recommends accusing (after the deposit it only suggests reviewing the board).
//   • Joseph Crackstone (enemy contract; only from publicState.crackstoneOf — his position only per R4, his telegraphs
//     per R9): curse circle while exposed → step out (an exit point outside the ring reachable at sprint speed before it
//     lands) or the duo's block_grab; scan warning while exposed → the nearest covered point (out of the ring, behind a
//     wall / high cover from him, or a hiding spot) reachable before the pulse — never "crouch" (a scan ignores it); he
//     sees / hunts you → break his line of sight behind a wall (low cover only hides a crouched player), hide, or leave
//     his leash disc; a stun / slow / distract that can hit HIM now (abilities.enemyTargetable); his area while his
//     rule-based risk at your spot is high and your objective lies elsewhere → a nearby low-risk cell on the way.
// Follow-up: each piece of advice is tracked → followed (true / false / null = no chance to) within a fixed window →
// outcome (undetected for 15 s after, or detected). Reported as "after", never "because".
import { CRACKSTONE_NAMES, enemyTargetable, hydeTargetable } from '../abilities.ts';
import { forward, wrapAngle, yawTo } from '../geometry.ts';
import { stanceNoiseRadius, stanceSpeed } from '../player.ts';
import type { MysteryRun } from '../run.ts';
import { ABILITY_KEY_LABEL, type AbilityDef, type AbilityEffect, type AbilityStatus, type HidingSpotDef, type HydeMode, type StampedEvent, type Vec2 } from '../types.ts';
import { zoneIndexAt } from './hydeZones.ts';
import { DETECTION_HORIZON_S, detectionTimes } from './labels.ts';
import { crackstoneCentroid, crackstoneOf, type CrackstonePublic } from './publicState.ts';
import { kindsOf, navDistance } from './state.ts';
import type { Advice, AdviceAction, AdviceOption, AdviceRecord, AreaProb, CrackstoneForecast, TelemetrySample, ZoneProb } from './types.ts';
import { publicView, topEggSite, type PublicView } from './view.ts';

export const ENGINE_LABEL = 'rule-based decision engine' as const;
/** UX_OVERHAUL R6: action ≤ 52 chars, why ≤ 48. */
export const MAX_TEXT = 52;
export const MAX_REASON = 48;

const ACTION_ORDER: readonly AdviceAction[] = [
  'leave_curse', 'take_cover', 'break_sight', 'evade', 'use_power', 'use_move', 'stop_sprinting', 'hide', 'stay_quiet', 'crouch', 'alt_route', 'deposit',
  'retrieve_egg', 'avoid_area', 'inspect_clue', 'go_to_tower', 'get_egg', 'search_room', 'review_evidence',
];

const MODE_WORD: Record<HydeMode, string> = {
  PATROL: 'patrolling', INVESTIGATE_SOUND: 'investigating', SEARCH: 'searching', CHASE: 'chasing', COOLDOWN: 'calming down',
};

export function fit(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function m(x: number): string {
  return `${Math.max(0, Math.round(x))} m`;
}

/** A probability at or above this (or at / below 1 − this) is a FACT in copy: words, never "100%" / "0%" (UX §7.2). */
export const CERTAIN_P = 0.995;

/** A probability as shown in copy — the UI's display rounding: 5 % steps, "<5%" / ">95%" (never 0 % / 100 %). */
export function pct(p: number): string {
  const x = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;
  if (x > 0.95) return '>95%';
  if (x < 0.05) return '<5%';
  return `${Math.min(95, Math.max(5, Math.round(x * 20) * 5))}%`;
}

/** `estimate(pct)` while uncertain, the `fact` in words once p ≥ CERTAIN_P. */
export function oddsCopy(p: number, estimate: (pctText: string) => string, fact: string): string {
  return p >= CERTAIN_P ? fact : estimate(pct(p));
}

interface Situation {
  run: MysteryRun;
  view: PublicView;
  p: Vec2;
  h: Vec2;
  d: number;
  mode: HydeMode;
  emerged: boolean;
  chased: boolean;
  alert: boolean;
  threat: boolean;
  neutral: boolean;
  los: boolean; // clear line between the Hyde and the player
  /** The player may use the Hyde's position: they see it, it chases them, or the HUD shows it investigating/searching. */
  known: boolean;
}

function situation(run: MysteryRun, view: PublicView): Situation {
  const p = run.player;
  const h = run.hyde;
  const emerged = view.emerged;
  const t = run.t;
  const d = emerged ? Math.hypot(h.x - p.x, h.z - p.z) : Infinity;
  const chased = emerged && h.mode === 'CHASE';
  const alert = emerged && (h.mode === 'INVESTIGATE_SOUND' || h.mode === 'SEARCH');
  return {
    run, view, p: { x: p.x, z: p.z }, h: { x: h.x, z: h.z }, d, mode: emerged ? h.mode : 'PATROL', emerged, chased, alert,
    threat: chased || (alert && d < 15),
    neutral: emerged && (t < h.stunnedUntil || t < h.distractedUntil || t < run.fx.lureUntil),
    los: emerged && run.world.lineOfSight(h.x, h.z, p.x, p.z, p.crouched),
    known: emerged && (view.visible || chased || alert),
  };
}

function dirWord(run: MysteryRun, x: number, z: number): string {
  const p = run.player;
  const a = wrapAngle(yawTo(p.x, p.z, x, z) - p.yaw);
  const deg = (Math.abs(a) * 180) / Math.PI;
  if (deg <= 45) return 'ahead';
  if (deg >= 135) return 'behind you';
  return a > 0 ? 'to your left' : 'to your right';
}

function areaName(view: PublicView, areaId: string): string {
  return view.world?.areas.find((a) => a.id === areaId)?.name ?? 'that area';
}

/**
 * "Get the egg" copy from the PUBLIC egg estimate: the seen site when the egg was seen, else the area of the most
 * probable candidate site (Bayesian), else the case file's objective. Never the hidden egg position.
 */
export function eggAdvice(run: MysteryRun, view: PublicView = publicView(run)): string {
  if (view.inv.eggSeenAt) {
    const s = view.egg.find((e) => e.siteId === view.inv.eggSeenAt);
    if (s) return fit(`Pick up the egg at the ${s.def.label}.`, MAX_TEXT);
  }
  const top = topEggSite(view, run.player);
  if (top) return fit(`Search the ${areaName(view, top.def.areaId)} for the egg.`, MAX_TEXT);
  const objective = run.caseDef?.egg?.objective?.trim().replace(/\.$/, '');
  return fit(`${objective || 'Find the egg'}.`, MAX_TEXT);
}

function opt(action: AdviceAction, text: string, reason: string, score: number, extra: Partial<AdviceOption> = {}): AdviceOption {
  return {
    action, text: fit(text, MAX_TEXT), reason: fit(reason, MAX_REASON), feasible: true, score,
    target: extra.target ?? null, ability: extra.ability ?? null, clueId: extra.clueId ?? null,
    ...(extra.targetLabel ? { targetLabel: extra.targetLabel } : {}),
    ...(extra.enemy ? { enemy: extra.enemy } : {}),
  };
}

/** Closest approach of segment a→b to point c. */
function passDistance(a: Vec2, b: Vec2, c: Vec2): number {
  const ax = b.x - a.x;
  const az = b.z - a.z;
  const len2 = ax * ax + az * az || 1;
  const t = Math.max(0, Math.min(1, ((c.x - a.x) * ax + (c.z - a.z) * az) / len2));
  return Math.hypot(a.x + ax * t - c.x, a.z + az * t - c.z);
}

function polylineMinDist(from: Vec2, path: readonly Vec2[], c: Vec2): number {
  let best = Math.hypot(from.x - c.x, from.z - c.z);
  let prev = from;
  for (const q of path) {
    best = Math.min(best, passDistance(prev, q, c));
    prev = q;
  }
  return best;
}

/** Nearest reachable hiding spot that is not toward the Hyde and not inside its reveal distance. */
export function safeHidingSpot(run: MysteryRun): { spot: HidingSpotDef; distM: number } | null {
  const p = run.player;
  const h = run.hyde;
  const nav = run.playerNav();
  let best: { spot: HidingSpotDef; distM: number } | null = null;
  for (const s of run.map.hidingSpots) {
    const dMe = Math.hypot(s.x - p.x, s.z - p.z);
    if (dMe > 20) continue;
    const dH = Math.hypot(s.x - h.x, s.z - h.z);
    if (dH < dMe + 2 || dH <= s.revealM + 1) continue;
    if (passDistance(p, s, h) < 4) continue;
    if (!nav.reachable(p, s, 2)) continue;
    if (!best || dMe < best.distM) best = { spot: s, distM: dMe };
  }
  return best;
}

/** A reachable point away from the Hyde and out of its sight line (or null). */
function evadePoint(run: MysteryRun): Vec2 | null {
  const p = run.player;
  const h = run.hyde;
  const nav = run.playerNav();
  const d0 = Math.hypot(h.x - p.x, h.z - p.z);
  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    for (const r of [6, 10, 14]) {
      const c = nav.nearestWalkable({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }, 1);
      if (!c || !nav.reachable(p, c, 1)) continue;
      const dH = Math.hypot(c.x - h.x, c.z - h.z);
      if (dH <= d0 || passDistance(p, c, h) < 3) continue;
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

function zoneWhy(p: number): string {
  return oddsCopy(p, (x) => `Hyde likely in this zone (${x})`, 'Hyde was just seen in this zone');
}

// ----------------------------------------------------------------------------------------------------- abilities

interface Relevance { score: number; purpose: string; reason: string }

/** P(at least one uncollected clue lies within `rangeM` of the player) from the clue posteriors (rangeM ≤ 0 = anywhere). */
export function clueChanceWithin(view: PublicView, at: Vec2, rangeM: number): number {
  const byClue = new Map<string, number>();
  for (const s of view.clueSites) {
    if (rangeM > 0 && Math.hypot(s.x - at.x, s.z - at.z) > rangeM) continue;
    byClue.set(s.clueId, (byClue.get(s.clueId) ?? 0) + s.p);
  }
  let none = 1;
  for (const q of byClue.values()) none *= 1 - Math.min(1, q);
  return 1 - none;
}

/** P(the resting egg lies within `rangeM`) from the egg posterior. */
function eggChanceWithin(view: PublicView, at: Vec2, rangeM: number): number {
  return view.egg.reduce((acc, s) => acc + (rangeM <= 0 || Math.hypot(s.def.x - at.x, s.def.z - at.z) <= rangeM ? s.p : 0), 0);
}

function effectRelevance(s: Situation, e: AbilityEffect, keyLabel: string): Relevance | null {
  const run = s.run;
  const t = run.t;
  const fx = run.fx;
  const active = run.hydeBrain.active && s.emerged;
  const d = s.d;
  switch (e.kind) {
    case 'stun':
    case 'slow':
    case 'distract': {
      if (!active || s.neutral) return null;
      const threat = s.chased || (s.alert && d < 15) || (run.hyde.canSeePlayer && d < 12);
      if (!threat) return null;
      if (!hydeTargetable(run, run.hydeBrain, e).ok) return null;
      const purpose = e.kind === 'stun' ? 'stop the Hyde' : e.kind === 'slow' ? 'slow the Hyde' : 'distract the Hyde';
      return { score: s.chased ? 96 : 78, purpose, reason: `It's ${m(d)} away and ${keyLabel} is ready` };
    }
    case 'lure': {
      if (!active || s.neutral) return null;
      if (s.chased && run.tuning.abilities.lureBreaksChase) return { score: 90, purpose: 'lure it away', reason: `It is chasing you, ${m(d)} away` };
      if (s.alert && d < 25) return { score: 74, purpose: 'lure it away', reason: `Hyde ${MODE_WORD[s.mode]} ${m(d)} away` };
      return null;
    }
    case 'block_grab':
      if (s.chased && d < 8 && t >= fx.blockGrabUntil) return { score: 88, purpose: 'block the next grab', reason: `Hyde ${m(d)} away — a grab is close` };
      return null;
    case 'egg_shield':
      if (run.egg.state === 'carried' && (s.chased || (s.alert && d < 10)) && t >= fx.eggShieldUntil) {
        return { score: 80, purpose: 'shield the egg', reason: `Carrying the egg; Hyde ${m(d)} away` };
      }
      return null;
    case 'speed_boost':
      if (s.chased && t >= fx.speedBoostUntil) return { score: 84, purpose: 'outrun it', reason: `It is chasing you, ${m(d)} away` };
      return null;
    case 'dash': {
      if (!s.chased || d >= 8 || d < 0.1) return null;
      const f = forward(run.player.yaw);
      const toH = { x: (s.h.x - s.p.x) / d, z: (s.h.z - s.p.z) / d };
      if (f.x * toH.x + f.z * toH.z > -0.3) return null; // only when facing away from the Hyde
      const free = run.world.rayFree(s.p.x, s.p.z, f.x, f.z, Math.max(1, e.magnitude), run.tuning.player.radius);
      if (free < 2.5) return null;
      return { score: 86, purpose: 'dash away', reason: `Hyde ${m(d)} behind you; the way is clear` };
    }
    case 'reveal_clues': {
      if (s.threat) return null;
      if (t < fx.revealCluesUntil || t < fx.scentUntil) return null;
      const obj = run.objective();
      if (obj === 'find_clues') {
        const q = clueChanceWithin(s.view, s.p, e.rangeM);
        if (q < 0.35) return null;
        return { score: 62, purpose: e.visual === 'scent_trail' ? 'follow the scent' : 'reveal evidence', reason: oddsCopy(q, (x) => `Clue chance in range ${x} · Bayesian`, 'A missing clue is within range') };
      }
      if (obj === 'find_egg' && !s.view.inv.eggSeenAt) {
        const q = eggChanceWithin(s.view, s.p, e.rangeM);
        if (q < 0.35) return null;
        return { score: 60, purpose: 'reveal the egg', reason: oddsCopy(q, (x) => `Egg odds in range ${x} · Bayesian`, 'The egg is within range') };
      }
      return null;
    }
    case 'reveal_hazards':
      if (s.alert && d < 20 && !s.chased && t >= fx.revealHazardsUntil) return { score: 60, purpose: 'show hiding spots', reason: `Hyde ${MODE_WORD[s.mode]} ${m(d)} away` };
      return null;
    case 'premonition':
      if (!active || s.chased || t < fx.premonitionUntil) return null;
      if (!(s.alert || (s.known && d < 25) || s.view.ownZoneP >= 0.4)) return null;
      if (e.rangeM > 0 && d > e.rangeM) return null;
      return { score: 64, purpose: 'see its next path', reason: s.known ? `Hyde ${MODE_WORD[s.mode]} ${m(d)} away` : zoneWhy(s.view.ownZoneP) };
    case 'power_switch':
      return null; // handled by abilityOption (needs the next-effect fallback rule)
  }
}

/**
 * Crackstone relevance of one effect (his position only per R4): a stun / slow / distract that the sim's own targeting
 * would apply to HIM now while he threatens you (chase, curse / scan you are exposed to, he sees you); block_grab while
 * a curse is about to land on you; speed_boost / dash while he chases you.
 */
function crackEffectRelevance(cs: CrackSituation | null, s: Situation, e: AbilityEffect, keyLabel: string): (Relevance & { enemy: 'crackstone' }) | null {
  if (!cs || !cs.pub.active) return null;
  const run = s.run;
  const t = run.t;
  const fx = run.fx;
  const threat = cs.chased || cs.curseExposed || cs.scanExposed || cs.seesYou;
  switch (e.kind) {
    case 'stun':
    case 'slow':
    case 'distract': {
      if (!threat || !cs.pose || cs.pub.stunned || cs.pub.lured) return null;
      if (e.kind === 'slow' && !cs.chased) return null; // a slow does not stop a curse / scan / his gaze
      if (!enemyTargetable(run, { active: cs.pub.active, x: cs.pose.x, z: cs.pose.z }, CRACKSTONE_NAMES, e).ok) return null;
      const purpose = e.kind === 'stun' ? 'stop Crackstone' : e.kind === 'slow' ? 'slow Crackstone' : 'distract Crackstone';
      const score = cs.curseExposed ? 97 : cs.scanExposed ? 93 : cs.chased ? 94 : 80;
      const why = cs.curseExposed ? 'It cancels the curse before it lands' : cs.scanExposed ? 'It cancels his scan' : `He is ${m(cs.d)} away and ${keyLabel} is ready`;
      return { score, purpose, reason: e.kind === 'slow' ? `He is hunting you, ${m(cs.d)} away` : why, enemy: 'crackstone' };
    }
    case 'block_grab':
      if (cs.curseExposed && t >= fx.blockGrabUntil) return { score: cs.curseEscape ? 90 : 96, purpose: 'block the curse', reason: 'The curse is about to land on you', enemy: 'crackstone' };
      return null;
    case 'speed_boost':
      if (cs.chased && t >= fx.speedBoostUntil) return { score: 84, purpose: 'outrun Crackstone', reason: `He is hunting you, ${m(cs.d)} away`, enemy: 'crackstone' };
      return null;
    case 'dash': {
      if (!cs.chased || !cs.pose || cs.d >= 8 || cs.d < 0.1) return null;
      const f = forward(run.player.yaw);
      const toC = { x: (cs.pose.x - s.p.x) / cs.d, z: (cs.pose.z - s.p.z) / cs.d };
      if (f.x * toC.x + f.z * toC.z > -0.3) return null;
      const free = run.world.rayFree(s.p.x, s.p.z, f.x, f.z, Math.max(1, e.magnitude), run.tuning.player.radius);
      if (free < 2.5) return null;
      return { score: 86, purpose: 'dash away', reason: `Crackstone ${m(cs.d)} behind you; way clear`, enemy: 'crackstone' };
    }
    default:
      return null;
  }
}

/** The best relevant use of ONE of the current duo's abilities, or null when not ready / not relevant / not feasible. */
export function abilityOption(s: Situation, key: 'F' | 'Q', def: AbilityDef, status: AbilityStatus, cs: CrackSituation | null = null): AdviceOption | null {
  if (!status.ready) return null;
  const run = s.run;
  const keyLabel = ABILITY_KEY_LABEL[key];
  let best: (Relevance & { enemy?: 'crackstone' }) | null = null;
  const effects = def.effects;
  for (let i = 0; i < effects.length; i++) {
    const e = effects[i];
    let r: Relevance | null = null;
    if (e.kind === 'power_switch') {
      const sw = run.map.powerSwitch;
      const reach = Math.max(e.rangeM, run.tuning.player.interactRangeM);
      const inReach = sw !== undefined && Math.hypot(sw.x - s.p.x, sw.z - s.p.z) <= reach;
      const hasNext = i + 1 < effects.length;
      if (inReach) {
        if (sw && !run.isWallOpen(sw.gateWallId) && !s.chased) r = { score: 55, purpose: 'open the gate', reason: 'The gate switch is within reach' };
        if (hasNext) i++; // activation powers the switch; the fallback effect will not apply
      } else if (!hasNext) {
        const stun = { ...e, kind: 'stun' as const }; // last effect: falls back to a stun with its own numbers
        r = effectRelevance(s, stun, keyLabel);
        const rc = crackEffectRelevance(cs, s, stun, keyLabel);
        if (rc && (!r || rc.score > r.score)) r = rc;
      }
      // not in reach with a next effect: the next effect is the one that applies (evaluated next iteration)
    } else {
      r = effectRelevance(s, e, keyLabel);
      const rc = crackEffectRelevance(cs, s, e, keyLabel);
      if (rc && (!r || rc.score > r.score)) r = rc;
    }
    if (r && (!best || r.score > best.score)) best = r;
  }
  if (!best) return null;
  const heals = def.effects.some((e) => (e.healHp ?? 0) > 0) && run.player.hp < run.player.maxHp;
  const purpose = heals && `${best.purpose} and heal`.length + def.name.length + 13 <= MAX_TEXT ? `${best.purpose} and heal` : best.purpose;
  return opt(key === 'F' ? 'use_power' : 'use_move', `Use ${def.name} (${keyLabel}) to ${purpose}.`, best.reason, best.score, {
    ability: { key, id: def.id, name: def.name, kinds: kindsOf(def) }, ...(best.enemy ? { enemy: best.enemy } : {}),
  });
}

// ----------------------------------------------------------------------------------------------------- Crackstone

/** Crackstone at this instant, as the player may know him (publicState.crackstoneOf; position only per R4). */
export interface CrackSituation {
  pub: CrackstonePublic;
  pose: { x: number; z: number; yaw: number } | null;
  /** Distance to him when his position is public, else Infinity. */
  d: number;
  chased: boolean;
  seesYou: boolean;
  scanExposed: boolean;
  scanLeftS: number;
  curseExposed: boolean;
  curseLeftS: number;
  /** A ring exit is reachable before the curse lands (computed with the leave_curse option). */
  curseEscape: boolean;
  /** forecasts.crackstone.here.p (rule-based), when the live engine passed it. */
  risk: number | null;
  riskFact: CrackstoneForecast['here']['fact'];
}

export function crackSituation(run: MysteryRun, forecast: CrackstoneForecast | null = null): CrackSituation | null {
  const pub = crackstoneOf(run, true);
  if (!pub || !pub.active) return null;
  const p = run.player;
  const pose = pub.pose;
  const scanEx = pub.scan?.phase === 'warning' ? run.scanExposure() : null;
  const curseEx = pub.curse ? run.curseExposure() : null;
  return {
    pub, pose, d: pose ? Math.hypot(pose.x - p.x, pose.z - p.z) : Infinity,
    chased: pub.mode === 'CHASE' || pub.mode === 'ATTACK', seesYou: pub.canSeePlayer,
    scanExposed: scanEx === 'exposed', scanLeftS: pub.scan ? Math.max(0, pub.scan.pulseAt - run.t) : 0,
    curseExposed: curseEx === 'exposed', curseLeftS: pub.curse ? Math.max(0, pub.curse.landsAt - run.t) : 0,
    curseEscape: false,
    risk: forecast ? forecast.here.p : null, riskFact: forecast ? forecast.here.fact : null,
  };
}

/** Sprint speed with every active multiplier, minus a reaction margin, for "reachable before it lands". */
function reachInS(run: MysteryRun, seconds: number, marginS = 0.25): number {
  return Math.max(0, seconds - marginS) * stanceSpeed(run, 'sprint');
}

/** Ring exit: the nearest walkable point just outside the curse circle reachable before it lands. */
function curseExit(run: MysteryRun, cs: CrackSituation): { at: Vec2; len: number } | null {
  const cu = cs.pub.curse;
  if (!cu) return null;
  const nav = run.playerNav();
  const p = run.player;
  const budget = reachInS(run, cs.curseLeftS, 0.15);
  let best: { at: Vec2; len: number } | null = null;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const q0 = { x: cu.x + Math.cos(a) * (cu.radiusM + 0.7), z: cu.z + Math.sin(a) * (cu.radiusM + 0.7) };
    const q = nav.nearestWalkable(q0, 0.6);
    if (!q || Math.hypot(q.x - cu.x, q.z - cu.z) <= cu.radiusM + 0.3) continue;
    const straight = Math.hypot(q.x - p.x, q.z - p.z);
    if (straight > budget || (best && straight >= best.len)) continue;
    const path = nav.findPath(p, q);
    if (!path) continue;
    const end = path.length ? path[path.length - 1] : p;
    if (Math.hypot(end.x - q.x, end.z - q.z) > 0.6) continue;
    const len = pathLen(p, path);
    if (len <= budget && (!best || len < best.len)) best = { at: { x: q.x, z: q.z }, len };
  }
  return best;
}

/** The nearest point that a scan pulse from him would NOT hit (out of the ring, behind a wall / high cover, or hidden). */
function scanCover(run: MysteryRun, cs: CrackSituation): { at: Vec2; len: number; how: 'out' | 'wall' | 'hide'; label: string } | null {
  if (!cs.pose) return null;
  const nav = run.playerNav();
  const p = run.player;
  const c = cs.pose;
  const radius = cs.pub.scan?.radiusM ?? cs.pub.cfg.scanRadiusM;
  const budget = reachInS(run, cs.scanLeftS);
  const cands: { at: Vec2; how: 'out' | 'wall' | 'hide'; label: string; straight: number }[] = [];
  for (const h of run.map.hidingSpots) {
    const straight = Math.hypot(h.x - p.x, h.z - p.z);
    if (straight <= budget && Math.hypot(h.x - c.x, h.z - c.z) > h.revealM + 0.5) cands.push({ at: { x: h.x, z: h.z }, how: 'hide', label: `Hiding spot (${h.kind})`, straight });
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    for (const r of [1.5, 3, 4.5, 6, 8]) {
      const q = nav.nearestWalkable({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }, 0.6);
      if (!q) continue;
      const straight = Math.hypot(q.x - p.x, q.z - p.z);
      if (straight > budget) continue;
      const dC = Math.hypot(q.x - c.x, q.z - c.z);
      if (dC > radius + 0.8) cands.push({ at: q, how: 'out', label: 'Out of his scan', straight });
      else if (!run.world.lineOfSight(c.x, c.z, q.x, q.z, false)) {
        cands.push({ at: q, how: 'wall', label: 'Cover', straight });
      }
    }
  }
  cands.sort((x, y) => x.straight - y.straight);
  let best: { at: Vec2; len: number; how: 'out' | 'wall' | 'hide'; label: string } | null = null;
  for (const k of cands.slice(0, 8)) {
    if (best && k.straight >= best.len) break;
    const path = nav.findPath(p, k.at);
    if (!path) continue;
    const end = path.length ? path[path.length - 1] : p;
    if (Math.hypot(end.x - k.at.x, end.z - k.at.z) > (k.how === 'hide' ? 1.2 : 0.6)) continue;
    const len = pathLen(p, path);
    if (len <= budget && (!best || len < best.len)) best = { at: k.at, len, how: k.how, label: k.label };
  }
  return best;
}

/** A reachable point out of his line of sight (walls + high cover), away from him. */
function breakSightPoint(run: MysteryRun, cs: CrackSituation): Vec2 | null {
  if (!cs.pose) return null;
  const p = run.player;
  const c = cs.pose;
  const nav = run.playerNav();
  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    for (const r of [3, 6, 10]) {
      const q = nav.nearestWalkable({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }, 1);
      if (!q || run.world.lineOfSight(c.x, c.z, q.x, q.z, false)) continue; // must be behind a wall / high cover
      const dC = Math.hypot(q.x - c.x, q.z - c.z);
      if (dC < cs.d - 1 || passDistance(p, q, c) < 2.5) continue; // never toward him
      if (!nav.reachable(p, q, 1)) continue;
      const score = dC - r * 0.6;
      if (score > bestScore) {
        bestScore = score;
        best = q;
      }
    }
  }
  return best;
}

/** A reachable point 6–14 m away that increases the distance to `from` and does not pass near it. */
function awayFrom(run: MysteryRun, from: Vec2): Vec2 | null {
  const p = run.player;
  const nav = run.playerNav();
  const d0 = Math.hypot(p.x - from.x, p.z - from.z);
  let best: Vec2 | null = null;
  let bestD = -Infinity;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    for (const r of [6, 10, 14]) {
      const q = nav.nearestWalkable({ x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r }, 1);
      if (!q) continue;
      const d = Math.hypot(q.x - from.x, q.z - from.z);
      if (d <= d0 + 2 || passDistance(p, q, from) < 3 || !nav.reachable(p, q, 1)) continue;
      if (d > bestD) {
        bestD = d;
        best = q;
      }
    }
  }
  return best;
}

/** A reachable hiding spot not toward him and outside its reveal distance from him. */
function crackHidingSpot(run: MysteryRun, cs: CrackSituation): { spot: HidingSpotDef; distM: number } | null {
  if (!cs.pose) return null;
  const p = run.player;
  const c = cs.pose;
  const nav = run.playerNav();
  let best: { spot: HidingSpotDef; distM: number } | null = null;
  for (const sp of run.map.hidingSpots) {
    const dMe = Math.hypot(sp.x - p.x, sp.z - p.z);
    if (dMe > 14) continue;
    const dC = Math.hypot(sp.x - c.x, sp.z - c.z);
    if (dC <= sp.revealM + 1 || dC < dMe + 1 || passDistance(p, sp, c) < 3) continue;
    if (!nav.reachable(p, sp, 2)) continue;
    if (!best || dMe < best.distM) best = { spot: sp, distM: dMe };
  }
  return best;
}

/** A reachable point just beyond his leash disc (he gives up there), if close. */
function leashExit(run: MysteryRun, cs: CrackSituation): { at: Vec2; len: number } | null {
  const def = cs.pub.def;
  const c0 = crackstoneCentroid(def);
  const p = run.player;
  const nav = run.playerNav();
  const d0 = Math.hypot(p.x - c0.x, p.z - c0.z);
  let best: { at: Vec2; len: number } | null = null;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const q = nav.nearestWalkable({ x: c0.x + Math.cos(a) * (def.leashM + 2), z: c0.z + Math.sin(a) * (def.leashM + 2) }, 2);
    if (!q || Math.hypot(q.x - c0.x, q.z - c0.z) <= def.leashM + 0.5) continue;
    if (Math.hypot(q.x - p.x, q.z - p.z) > Math.max(16, def.leashM + 2 - d0 + 4)) continue;
    if (cs.pose && passDistance(p, q, cs.pose) < 3) continue;
    const path = nav.findPath(p, q);
    if (!path) continue;
    const end = path.length ? path[path.length - 1] : p;
    if (Math.hypot(end.x - q.x, end.z - q.z) > 1) continue;
    const len = pathLen(p, path);
    if (len <= 16 && (!best || len < best.len)) best = { at: q, len };
  }
  return best;
}

/** The Crackstone options of this instant (feasible only), plus whether one of them is an immediate threat response. */
function crackOptions(run: MysteryRun, cs: CrackSituation, crack: CrackstoneForecast | null, goal: Vec2 | null): AdviceOption[] {
  const out: AdviceOption[] = [];
  const p = run.player;
  const enemy = 'crackstone' as const;
  if (cs.curseExposed) {
    const ex = curseExit(run, cs);
    cs.curseEscape = ex !== null;
    if (ex) {
      out.push(opt('leave_curse', `Step out of the curse ring ${dirWord(run, ex.at.x, ex.at.z)}!`, `It lands in ${cs.curseLeftS.toFixed(1)} s. Keep moving.`, 99,
        { target: ex.at, targetLabel: 'Out of the ring', enemy }));
    }
  }
  if (cs.scanExposed) {
    const cover = scanCover(run, cs);
    if (cover) {
      const where = dirWord(run, cover.at.x, cover.at.z);
      const text = cover.how === 'hide' ? `Hide and crouch in the spot ${where}!` : cover.how === 'out' ? `Get out of his scan ring ${where}!` : `Duck behind cover ${where}! Crouching won't help.`;
      out.push(opt('take_cover', text, `Scan in ${cs.scanLeftS.toFixed(1)} s: walls and hiding block it`, 98, { target: cover.at, targetLabel: cover.label, enemy }));
    }
  }
  if ((cs.chased || cs.seesYou) && cs.pose && !p.hidden) {
    const bp = breakSightPoint(run, cs);
    const why = cs.chased ? `Crackstone ${m(cs.d)} away is hunting you` : `He sees you ${m(cs.d)} away; crouching isn't enough`;
    if (bp) out.push(opt('break_sight', `Get behind a wall ${dirWord(run, bp.x, bp.z)}. He hunts by sight.`, why, cs.chased ? 92 : 87, { target: bp, targetLabel: 'Out of his sight', enemy }));
    const hs = crackHidingSpot(run, cs);
    if (hs) {
      out.push(opt('hide', `Hide in the ${hs.spot.kind} ${m(hs.distM)} ${dirWord(run, hs.spot.x, hs.spot.z)}.`, "He can't see into a hiding spot", cs.chased ? 86 : 84,
        { target: { x: hs.spot.x, z: hs.spot.z }, targetLabel: `Hiding spot (${hs.spot.kind})`, enemy }));
    }
    if (cs.chased) {
      const le = leashExit(run, cs);
      if (le) out.push(opt('avoid_area', `Leave his area ${dirWord(run, le.at.x, le.at.z)}. He won't follow.`, 'He gives up beyond his cursed area', 88, { target: le.at, targetLabel: 'Out of his area', enemy }));
    }
    if (cs.chased && !bp) {
      // no wall close by: put distance between you (his chase speed is below your sprint)
      const away = awayFrom(run, cs.pose);
      if (away) out.push(opt('evade', `Sprint ${dirWord(run, away.x, away.z)}, away from Crackstone.`, 'Your sprint is faster than his stride', 83, { target: away, targetLabel: 'Escape', enemy }));
    }
  }
  // his area while the rule-based risk at your spot is high and your objective lies elsewhere
  if (!cs.chased && !cs.seesYou && !p.hidden && crack && crack.here.fact === null && crack.here.p >= 0.5 && crack.cells.length > 0) {
    const c0 = crackstoneCentroid(cs.pub.def);
    const goalOutside = goal === null || Math.hypot(goal.x - c0.x, goal.z - c0.z) > cs.pub.def.leashM;
    if (goalOutside) {
      const nav = run.playerNav();
      const near = crack.cells.filter((c) => c.p < 0.15).map((c) => ({ c, d: Math.hypot(c.x - p.x, c.z - p.z) })).filter((x) => x.d >= 3 && x.d <= 14)
        .sort((a, b) => a.d - b.d).slice(0, 6);
      const direct = goal ? navDistance(run, goal, 2.5) : null;
      for (const { c } of near) {
        const q = nav.nearestWalkable({ x: c.x, z: c.z }, 2);
        if (!q) continue;
        const a = navDistance(run, q, 1);
        if (a === null) continue;
        if (goal && direct !== null) {
          const b = nav.findPath(q, goal);
          if (!b) continue;
          if (a + pathLen(q, b) > direct * 1.6 + 15) continue;
        }
        out.push(opt('avoid_area', `Crackstone may see you here. Move ${dirWord(run, q.x, q.z)}.`, oddsCopy(crack.here.p, (x) => `Sees this spot within 10 s: ${x} · Rule-based`, 'He will see this spot soon'), 72,
          { target: q, targetLabel: 'Out of his sight lines', enemy }));
        break;
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------------------------------------------- search targets

interface SearchPick { area: AreaProb; p: number; target: Vec2; label: string; clueId: string | null; inside: boolean; siteP: number }

/**
 * The clue area to search: maximises P(area holds ≥ 1 uncollected clue) / (1 + distance / 30 m) over reachable areas.
 * Inside the area the target is its most probable unchecked candidate site.
 */
export function bestClueArea(run: MysteryRun, view: PublicView): SearchPick | null {
  const p = run.player;
  const nav = run.playerNav();
  const ranked = view.areas
    .filter((a) => a.p > 1e-6)
    .map((a) => ({ a, score: a.p / (1 + Math.hypot(a.x - p.x, a.z - p.z) / 30) }))
    .sort((x, y) => y.score - x.score);
  for (const { a } of ranked) {
    const sites = view.clueSites.filter((s) => s.areaId === a.areaId && s.p > 1e-6).sort((x, y) => y.p - x.p);
    if (sites.length === 0) continue;
    const site = sites[0];
    if (!nav.reachable(p, site, run.tuning.player.interactRangeM + 0.7)) continue;
    const inside = Math.hypot(a.x - p.x, a.z - p.z) <= a.radiusM;
    return {
      area: a, p: a.p, target: inside ? { x: site.x, z: site.z } : { x: a.x, z: a.z }, label: inside ? site.label : a.name,
      clueId: site.clueId, inside, siteP: site.p,
    };
  }
  return null;
}

// ----------------------------------------------------------------------------------------------------- zone routing

function zoneOfPoint(view: PublicView, q: Vec2): number {
  return view.world ? zoneIndexAt(view.world.zones, q.x, q.z) : -1;
}

/** Zones a polyline crosses (sampled every ~2 m). */
function zonesOnPath(view: PublicView, from: Vec2, path: readonly Vec2[]): Set<number> {
  const out = new Set<number>();
  let prev = from;
  for (const q of path) {
    const len = Math.hypot(q.x - prev.x, q.z - prev.z);
    const n = Math.max(1, Math.ceil(len / 2));
    for (let k = 1; k <= n; k++) out.add(zoneOfPoint(view, { x: prev.x + ((q.x - prev.x) * k) / n, z: prev.z + ((q.z - prev.z) * k) / n }));
    prev = q;
  }
  return out;
}

function centroid(poly: readonly Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const q of poly) {
    x += q.x;
    z += q.z;
  }
  return { x: x / Math.max(1, poly.length), z: z / Math.max(1, poly.length) };
}

function pathLen(from: Vec2, path: readonly Vec2[]): number {
  let total = 0;
  let prev = from;
  for (const q of path) {
    total += Math.hypot(q.x - prev.x, q.z - prev.z);
    prev = q;
  }
  return total;
}

/**
 * Zone-risk detour (Hyde NOT visible): when the direct nav route to `goal` crosses a zone other than the player's own
 * and the goal's whose probability is ≥ 0.45, find a route via a low-risk zone (p < 0.15) that avoids it.
 */
function zoneDetour(run: MysteryRun, goal: Vec2, view: PublicView, zones: readonly ZoneProb[]): AdviceOption | null {
  if (!view.world) return null;
  const nav = run.playerNav();
  const p = { x: run.player.x, z: run.player.z };
  const direct = nav.findPath(p, goal);
  if (!direct || direct.length === 0) return null;
  const own = zoneOfPoint(view, p);
  const goalZone = zoneOfPoint(view, goal);
  const crossed = zonesOnPath(view, p, direct);
  let risky = -1;
  for (const i of crossed) if (i >= 0 && i !== own && i !== goalZone && zones[i].p >= 0.45 && (risky < 0 || zones[i].p > zones[risky].p)) risky = i;
  if (risky < 0) return null;
  const directLen = pathLen(p, direct);
  let best: { via: Vec2; zone: number; len: number } | null = null;
  const order = zones.map((z, i) => ({ i, p: z.p })).filter((z) => z.p < 0.15 && z.i !== risky).sort((a, b) => a.p - b.p).slice(0, 4);
  for (const { i } of order) {
    const v = nav.nearestWalkable(centroid(view.world.zones[i].polygon), 6);
    if (!v || !nav.reachable(p, v, 1)) continue;
    const a = nav.findPath(p, v);
    const b = nav.findPath(v, goal);
    if (!a || !b || b.length === 0) continue;
    if (zonesOnPath(view, p, a).has(risky) || zonesOnPath(view, v, b).has(risky)) continue;
    const len = pathLen(p, a) + pathLen(v, b);
    if (len > directLen * 1.8 + 25) continue;
    if (!best || len < best.len) best = { via: v, zone: i, len };
  }
  if (!best) return null;
  return opt('alt_route', `Go around via the ${zones[best.zone].name}.`, oddsCopy(zones[risky].p, (x) => `Hyde likely in the ${zones[risky].name} (${x})`, `Hyde was just seen in the ${zones[risky].name}`), 68, { target: best.via, targetLabel: zones[best.zone].name });
}

// ----------------------------------------------------------------------------------------------------- engine

export class PrescriptiveService {
  readonly engine = ENGINE_LABEL;

  /**
   * Every feasible option, best first. Empty when the run is not in play / accusing. `zones` = the session's Hyde-zone
   * estimate (LiveForecasts.hyde.zones) when available.
   */
  candidates(run: MysteryRun, zones: ZoneProb[] | null = null, crack: CrackstoneForecast | null = null): AdviceOption[] {
    if (run.status === 'accusing') {
      return [opt('review_evidence', 'Review the evidence on Tab.', 'Weigh what each clue you found says', 50)];
    }
    if (run.status !== 'playing') return [];
    const view = publicView(run, zones);
    const s = situation(run, view);
    const out: AdviceOption[] = [];
    const p = run.player;
    const d = s.d;
    const tol = run.tuning.player.interactRangeM + 0.7;
    const fragile = p.catches >= 1 || p.hp <= 40 ? 4 : 0; // one more grab hurts: safety a little higher

    // ---- Joseph Crackstone (public state only)
    const cs = crackSituation(run, crack);
    // ---- the duo's own abilities (by effect kind)
    if (cs && cs.curseExposed) cs.curseEscape = curseExit(run, cs) !== null;
    const f = abilityOption(s, 'F', run.power.def, run.powerStatus(), cs);
    if (f) out.push(f);
    const q = abilityOption(s, 'Q', run.move.def, run.moveStatus(), cs);
    if (q) out.push(q);

    // ---- immediate safety (Hyde whereabouts public: chase / HUD alert / in sight)
    if (s.chased) {
      const ev = evadePoint(run);
      out.push(opt('evade', ev ? `Sprint ${dirWord(run, ev.x, ev.z)} and break its line of sight.` : 'Sprint away and break its line of sight.',
        `It is chasing you, ${m(d)} away`, 90, { target: ev, targetLabel: 'Escape' }));
    }
    const ownRisk = view.ownZoneP;
    if (p.stance === 'sprint' && !s.chased && s.emerged) {
      const sprintR = stanceNoiseRadius(run, 'sprint');
      if (s.known && d <= sprintR * 1.6) out.push(opt('stop_sprinting', 'Stop sprinting. Walk or crouch.', `Sprinting is heard ${m(sprintR)} off`, 88 + fragile));
      else if (!s.known && ownRisk >= 0.3) out.push(opt('stop_sprinting', 'Walk slowly. Your noise is rising.', zoneWhy(ownRisk), 76 + fragile));
    }
    if (p.hidden) {
      if (s.alert || (s.known && d < 12 && !s.chased)) out.push(opt('stay_quiet', 'Stay hidden and keep still.', `Hyde ${MODE_WORD[s.mode]} ${m(d)} away`, 84));
    } else if (s.emerged) {
      const hideScore = s.chased && d > 4 ? 85 : s.alert && d < 18 ? 82 : s.view.visible && (s.mode === 'PATROL' || s.mode === 'COOLDOWN') && s.los && d < 14 ? 70 : 0;
      if (hideScore > 0) {
        const hs = safeHidingSpot(run);
        if (hs) {
          out.push(opt('hide', `Hide in the ${hs.spot.kind} ${m(hs.distM)} ${dirWord(run, hs.spot.x, hs.spot.z)}.`,
            `Hyde ${MODE_WORD[s.mode]} ${m(d)} away`, hideScore + fragile, { target: { x: hs.spot.x, z: hs.spot.z }, targetLabel: `Hiding spot (${hs.spot.kind})` }));
        }
      }
    }
    if (!p.crouched && !s.chased && s.emerged) {
      const walkR = stanceNoiseRadius(run, 'walk');
      if ((s.alert && d < 20) || (s.view.visible && s.los && d < 16)) {
        out.push(opt('crouch', 'Crouch (C) and move slowly.', `Hyde ${m(d)} away; steps carry ${m(walkR)}`, (s.alert ? 80 : 72) + fragile));
      } else if (!s.known && ownRisk >= 0.4 && p.stance !== 'idle') {
        out.push(opt('crouch', 'Stay quiet. Hyde nearby. Crouch (C).', zoneWhy(ownRisk), 72 + fragile));
      }
    }
    if (!s.known && s.emerged && ownRisk >= 0.4 && p.crouched && !p.hidden) {
      out.push(opt('stay_quiet', 'Stay quiet. Hyde nearby.', zoneWhy(ownRisk), 66 + fragile));
    }

    // ---- objective (public targets only)
    const egg = run.egg;
    let goal: Vec2 | null = null;
    if (egg.state === 'carried') {
      const tw = run.map.tower;
      goal = { x: tw.x, z: tw.z };
      const inTower = Math.hypot(p.x - tw.x, p.z - tw.z) <= tw.radius;
      if (inTower) out.push(opt('deposit', 'Hold E here to deposit the egg.', "You are inside Iago Tower's circle", s.chased ? 70 : 92, { target: { x: tw.x, z: tw.z }, targetLabel: 'Iago Tower' }));
      else {
        const dt = navDistance(run, tw, tw.radius + 1);
        if (dt !== null) out.push(opt('go_to_tower', 'Take the egg to Iago Tower.', `Tower ${m(dt)} away · egg security ${Math.round(egg.security)}`, s.threat ? 50 : 66, { target: { x: tw.x, z: tw.z }, targetLabel: 'Iago Tower' }));
      }
    } else if (egg.state === 'dropped' && view.eggKnownAt) {
      const at = view.eggKnownAt;
      goal = at;
      const de = navDistance(run, at, tol);
      if (de !== null) out.push(opt('retrieve_egg', 'Go back and pick up the egg (E).', `The egg lies ${m(de)} away`, s.threat ? 52 : 70, { target: { x: at.x, z: at.z }, targetLabel: 'Dropped egg' }));
    } else if (egg.state === 'resting' && run.objective() === 'find_egg') {
      const seen = view.inv.eggSeenAt ? view.egg.find((e) => e.siteId === view.inv.eggSeenAt) ?? null : null;
      const top = seen ?? topEggSite(view, p);
      if (top) {
        const area = view.world?.areas.find((a) => a.id === top.def.areaId) ?? null;
        const inside = area !== null && Math.hypot(area.x - p.x, area.z - p.z) <= area.radiusM;
        const target = seen || inside || !area ? { x: top.def.x, z: top.def.z } : { x: area.x, z: area.z };
        goal = target;
        if (run.playerNav().reachable(p, { x: top.def.x, z: top.def.z }, tol)) {
          out.push(opt('get_egg', seen ? eggAdvice(run, view) : inside ? `Check the ${top.def.label} for the egg.` : eggAdvice(run, view),
            seen ? 'You saw it there' : oddsCopy(top.p, (x) => `Egg odds ${x} · Bayesian estimate`, 'The egg can only be there'), s.threat ? 48 : 64, { target, targetLabel: seen || inside || !area ? top.def.label : area.name }));
        }
      }
    }
    if (egg.state !== 'carried' && egg.state !== 'delivered' && run.objective() === 'find_clues') {
      const pick = bestClueArea(run, view);
      if (pick) {
        goal = pick.target;
        const found = run.cluesFound.length;
        const total = run.caseDef.clues.length;
        if (pick.inside) {
          out.push(opt('inspect_clue', `Check the ${pick.label} ${dirWord(run, pick.target.x, pick.target.z)}.`, oddsCopy(pick.siteP, (x) => `Most likely spot here: ${x}`, 'The only possible spot here'), s.threat ? 50 : 68,
            { target: pick.target, clueId: pick.clueId, targetLabel: pick.label }));
        } else {
          const left = total - found;
          out.push(opt('search_room', left === 1 ? `One clue left. Search the ${pick.area.name}.` : `Search the ${pick.area.name}.`,
            oddsCopy(pick.p, (x) => `Clue chance ${x} · Bayesian estimate`, 'A missing clue is there'), s.threat ? 40 : 60, { target: pick.target, clueId: pick.clueId, targetLabel: pick.area.name }));
        }
      }
    }
    if (cs) out.push(...crackOptions(run, cs, crack, goal));
    if (goal && !s.chased) {
      if (s.known && d < 25) {
        const alt = this.alternativeRoute(run, goal, s);
        if (alt) out.push(alt);
      } else if (!s.known && s.emerged && view.zones) {
        const alt = zoneDetour(run, goal, view, view.zones);
        if (alt) out.push(alt);
      }
    }
    if (out.length === 0 || out.every((o) => o.score < 20)) {
      out.push(opt('stay_quiet', 'Keep moving quietly.', !s.emerged ? 'The Hyde has not emerged yet' : s.known ? `Hyde ${MODE_WORD[s.mode]} ${m(d)} away` : 'Its odds are spread out for now', 10));
    }
    return out.sort((a, b) => b.score - a.score || ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action));
  }

  /** One concise, feasible suggestion (+ up to two alternatives), or null when nothing applies (run not in play). */
  recommend(run: MysteryRun, zones: ZoneProb[] | null = null, crack: CrackstoneForecast | null = null): Advice | null {
    const all = this.candidates(run, zones, crack);
    if (all.length === 0) return null;
    const [best, ...rest] = all;
    const alternatives: AdviceOption[] = [];
    for (const o of rest) {
      if (o.action === best.action || alternatives.some((a) => a.action === o.action)) continue;
      alternatives.push(o);
      if (alternatives.length >= 2) break;
    }
    return { ...best, t: Math.round(run.t * 1000) / 1000, alternatives, engine: ENGINE_LABEL };
  }

  /** A detour that keeps ≥ 9 m from the (publicly located) Hyde when the direct route passes within 6 m of it. */
  private alternativeRoute(run: MysteryRun, goal: Vec2, s: Situation): AdviceOption | null {
    const nav = run.playerNav();
    const p = s.p;
    const direct = nav.findPath(p, goal);
    if (!direct || direct.length === 0) return null;
    const closest = polylineMinDist(p, direct, s.h);
    if (closest > 6) return null;
    const directLen = pathLen(p, direct);
    const vias: Vec2[] = [
      ...run.map.rooms.map((r) => centroid(r.polygon)),
      ...run.map.hidingSpots.map((h) => ({ x: h.x, z: h.z })),
    ];
    let best: { via: Vec2; len: number } | null = null;
    for (const v0 of vias) {
      const v = nav.nearestWalkable(v0, 3);
      if (!v || Math.hypot(v.x - p.x, v.z - p.z) < 4 || !nav.reachable(p, v, 1)) continue;
      const a = nav.findPath(p, v);
      const b = nav.findPath(v, goal);
      if (!a || !b || a.length === 0 || b.length === 0) continue;
      const endB = b[b.length - 1];
      if (Math.hypot(endB.x - goal.x, endB.z - goal.z) > 2.5) continue;
      if (polylineMinDist(p, a, s.h) < 9 || polylineMinDist(v, b, s.h) < 9) continue;
      const len = pathLen(p, a) + pathLen(v, b);
      if (len > directLen * 2.5 + 15) continue;
      if (!best || len < best.len) best = { via: v, len };
    }
    if (!best) return null;
    const room = run.roomAt(best.via.x, best.via.z)?.name ?? 'open ground';
    return opt('alt_route', `Go around via the ${room}.`, `The direct route passes ${m(closest)} from it`, s.alert ? 76 : 68, { target: best.via, targetLabel: room });
  }
}

// ----------------------------------------------------------------------------------------------------- follow-up

/** Seconds after the advice within which the action counts as followed. */
export const FOLLOW_WINDOW_S: Record<AdviceAction, number> = {
  evade: 4, hide: 10, crouch: 5, stop_sprinting: 3, alt_route: 10, use_power: 8, use_move: 8, inspect_clue: 30,
  search_room: 45, get_egg: 30, retrieve_egg: 30, go_to_tower: 10, deposit: 10, stay_quiet: 8, review_evidence: 0,
  take_cover: 4, leave_curse: 3, break_sight: 6, avoid_area: 10,
};

export interface FollowView {
  events: readonly StampedEvent[];
  samples: readonly TelemetrySample[];
  nowT: number;
  ended: boolean;
}

function within<T extends { t: number }>(xs: readonly T[], t0: number, t1: number): T[] {
  return xs.filter((x) => x.t > t0 && x.t <= t1);
}

/** true / false once decidable; null while pending or when the run ended before the window closed without it. */
export function evaluateFollow(rec: AdviceRecord, v: FollowView): boolean | null {
  const a = rec.advice;
  const t0 = rec.t;
  const win = FOLLOW_WINDOW_S[a.action];
  if (win <= 0) return null;
  const t1 = t0 + win;
  const seen = Math.min(t1, v.nowT); // only what has happened so far
  const ev = within(v.events, t0, seen);
  const samples = v.samples.filter((s) => s.snapshot.t > t0 && s.snapshot.t <= seen);
  const posOf = (s: TelemetrySample) => (s.context ? { x: s.context.x, z: s.context.z } : null);
  const closerTo = (target: Vec2 | null, by: number) => {
    if (!target || !rec.startPos) return false;
    const d0 = Math.hypot(rec.startPos.x - target.x, rec.startPos.z - target.z);
    return samples.some((s) => {
      const q = posOf(s);
      return q !== null && Math.hypot(q.x - target.x, q.z - target.z) <= d0 - by;
    });
  };
  let done = false;
  switch (a.action) {
    case 'evade':
      done = ev.some((e) => e.type === 'hyde_mode' && e.from === 'CHASE')
        || (rec.startHydeDistM !== null && samples.some((s) => s.snapshot.hydeDistanceM >= (rec.startHydeDistM ?? 0) + 2));
      break;
    case 'hide':
      done = samples.some((s) => s.snapshot.hidden);
      break;
    case 'crouch':
      done = ev.some((e) => e.type === 'stance' && e.stance === 'crouch') || samples.some((s) => s.snapshot.stance === 'crouch');
      break;
    case 'stop_sprinting':
      done = ev.some((e) => e.type === 'stance' && e.stance !== 'sprint') || samples.some((s) => s.snapshot.stance !== 'sprint');
      break;
    case 'stay_quiet':
      if (ev.some((e) => e.type === 'stance' && e.stance === 'sprint')) return false;
      return v.nowT >= t1 ? true : null;
    case 'use_power':
    case 'use_move': {
      const key = a.action === 'use_power' ? 'F' : 'Q';
      done = ev.some((e) => e.type === 'ability_used' && e.key === key);
      break;
    }
    case 'inspect_clue':
    case 'search_room':
      done = ev.some((e) => ((e.type === 'clue_search_start' || e.type === 'clue_found') && e.clueId === a.clueId) || (e.type === 'site_checked' && e.site === 'clue'))
        || closerTo(a.target, 4);
      break;
    case 'get_egg':
    case 'retrieve_egg':
      done = ev.some((e) => e.type === 'egg_pickup' || (a.action === 'get_egg' && e.type === 'site_checked' && e.site === 'egg'));
      break;
    case 'deposit':
      done = ev.some((e) => e.type === 'egg_delivered');
      break;
    case 'go_to_tower':
      done = ev.some((e) => e.type === 'egg_delivered') || closerTo(a.target, 5);
      break;
    case 'alt_route':
      done = closerTo(a.target, 3);
      break;
    case 'take_cover':
      done = ev.some((e) => e.type === 'crackstone_scan' && e.phase === 'pulse' && !e.hit) || closerTo(a.target, 1.5);
      break;
    case 'leave_curse':
      done = ev.some((e) => e.type === 'curse' && e.phase === 'miss');
      break;
    case 'break_sight':
      done = ev.some((e) => e.type === 'crackstone_lost' || (e.type === 'crackstone_mode' && (e.from === 'CHASE' || e.from === 'ATTACK') && e.to !== 'CHASE' && e.to !== 'ATTACK'));
      break;
    case 'avoid_area':
      done = closerTo(a.target, 3);
      break;
    case 'review_evidence':
      return null;
  }
  if (done) return true;
  if (v.nowT >= t1) return false;
  return null; // still open (or the run ended first: "no chance to")
}

/** 'undetected_15s' / 'detected_15s' once 15 s have been observed (or a detection happened), else null. */
/** Crackstone "detections" for the follow-up of his advice: encounter onsets (chase by sight / proximity / scan) + landed curses. */
export function crackDetectionTimes(events: readonly StampedEvent[]): number[] {
  return events.filter((e) => (e.type === 'crackstone_mode' && e.to === 'CHASE' && e.from !== 'ATTACK' && (e.reason === 'saw_player' || e.reason === 'sensed_player' || e.reason === 'scan_hit'))
    || (e.type === 'curse' && e.phase === 'hit')).map((e) => e.t);
}

export function evaluateOutcome(rec: AdviceRecord, v: FollowView): AdviceRecord['outcome'] {
  const det = rec.advice.enemy === 'crackstone' ? crackDetectionTimes(v.events) : detectionTimes(v.events);
  if (det.some((x) => x > rec.t && x <= rec.t + DETECTION_HORIZON_S && x <= v.nowT)) return 'detected_15s';
  if (v.nowT >= rec.t + DETECTION_HORIZON_S) return 'undetected_15s';
  return null;
}

export interface AdviceSummary {
  given: number;
  followed: number;
  notFollowed: number;
  noChance: number;
  followedObserved: number; // followed with a known 15 s outcome
  undetectedAfterFollowed: number;
  notFollowedObserved: number;
  undetectedAfterNotFollowed: number;
  text: string;
}

export function summariseAdvice(records: readonly Pick<AdviceRecord, 'followed' | 'outcome'>[]): AdviceSummary {
  const followed = records.filter((r) => r.followed === true);
  const notFollowed = records.filter((r) => r.followed === false);
  const fo = followed.filter((r) => r.outcome !== null);
  const no = notFollowed.filter((r) => r.outcome !== null);
  const u = fo.filter((r) => r.outcome === 'undetected_15s').length;
  const un = no.filter((r) => r.outcome === 'undetected_15s').length;
  let text = records.length === 0
    ? 'Thing gave no advice this run.'
    : `You followed ${followed.length} of ${records.length} tip${records.length === 1 ? '' : 's'}.`;
  if (fo.length > 0) text += ` After following, you stayed undetected for 15 s in ${u} of ${fo.length} case${fo.length === 1 ? '' : 's'}.`;
  return {
    given: records.length, followed: followed.length, notFollowed: notFollowed.length,
    noChance: records.length - followed.length - notFollowed.length,
    followedObserved: fo.length, undetectedAfterFollowed: u, notFollowedObserved: no.length, undetectedAfterNotFollowed: un, text,
  };
}

// PrescriptiveService — "What should be done?". An honest, deterministic RULE-BASED DECISION ENGINE (no reinforcement
// learning, no optimiser): it enumerates candidate actions from the live run state, keeps only the FEASIBLE ones, scores
// them by a fixed priority table and returns the best with a real reason taken from the state, plus alternatives.
//
// Feasibility guarantees (tested over many bot states, for every duo):
//   • abilities: only the CURRENT duo's own F (run.power) / Q (run.move), only when ready (not cooling), only when
//     relevant, and Hyde-targeted effects only when the sim's own targeting rule (range, line of sight, facing cone)
//     would accept them right now — never another character's power;
//   • clues: only uncollected ones that the nav graph can reach; hiding spots: reachable, not toward the Hyde, not
//     inside its reveal distance; routes: real nav paths;
//   • never names a suspect and never recommends accusing (after the deposit it only suggests reviewing the board).
// Follow-up: each piece of advice is tracked → followed (true / false / null = no chance to) within a fixed window →
// outcome (undetected for 15 s after, or detected). Reported as "after", never "because".
import { hydeTargetable } from '../abilities.ts';
import { forward, wrapAngle, yawTo } from '../geometry.ts';
import { stanceNoiseRadius } from '../player.ts';
import type { MysteryRun } from '../run.ts';
import type { AbilityDef, AbilityEffect, AbilityStatus, HidingSpotDef, HydeMode, StampedEvent, Vec2 } from '../types.ts';
import { DETECTION_HORIZON_S, detectionTimes } from './labels.ts';
import { kindsOf, navDistance, objectiveTarget } from './state.ts';
import type { Advice, AdviceAction, AdviceOption, AdviceRecord, TelemetrySample } from './types.ts';

export const ENGINE_LABEL = 'rule-based decision engine' as const;
export const MAX_TEXT = 60;
export const MAX_REASON = 55; // shown as "Why: …" (≤ 60)

const ACTION_ORDER: readonly AdviceAction[] = [
  'evade', 'use_power', 'use_move', 'stop_sprinting', 'hide', 'stay_quiet', 'crouch', 'alt_route', 'deposit',
  'retrieve_egg', 'inspect_clue', 'go_to_tower', 'get_egg', 'search_room', 'review_evidence',
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

interface Situation {
  run: MysteryRun;
  p: Vec2;
  h: Vec2;
  d: number;
  mode: HydeMode;
  chased: boolean;
  alert: boolean;
  threat: boolean;
  neutral: boolean;
  los: boolean; // clear line between the Hyde and the player
}

function situation(run: MysteryRun): Situation {
  const p = run.player;
  const h = run.hyde;
  const d = Math.hypot(h.x - p.x, h.z - p.z);
  const t = run.t;
  const chased = h.mode === 'CHASE';
  const alert = h.mode === 'INVESTIGATE_SOUND' || h.mode === 'SEARCH';
  return {
    run, p: { x: p.x, z: p.z }, h: { x: h.x, z: h.z }, d, mode: h.mode, chased, alert,
    threat: chased || (alert && d < 15),
    neutral: t < h.stunnedUntil || t < h.distractedUntil || t < run.fx.lureUntil,
    los: run.world.lineOfSight(h.x, h.z, p.x, p.z, p.crouched),
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

function roomName(run: MysteryRun, x: number, z: number): string {
  return run.roomAt(x, z)?.name ?? 'open ground';
}

/**
 * "Get the egg" copy from the CASE being played: the case file's egg objective ("Find the egg in the burial vault of
 * the crypt."), else the (case-renamed) room the egg rests in. Never a fixed room name.
 */
export function eggAdvice(run: MysteryRun): string {
  const objective = run.caseDef?.egg?.objective?.trim().replace(/\.$/, '');
  if (objective) return fit(objective, MAX_TEXT);
  return fit(`Fetch the egg from the ${roomName(run, run.egg.x, run.egg.z)}`, MAX_TEXT);
}

function opt(action: AdviceAction, text: string, reason: string, score: number, extra: Partial<AdviceOption> = {}): AdviceOption {
  return {
    action, text: fit(text, MAX_TEXT), reason: fit(reason, MAX_REASON), feasible: true, score,
    target: extra.target ?? null, ability: extra.ability ?? null, clueId: extra.clueId ?? null,
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

// ----------------------------------------------------------------------------------------------------- abilities

interface Relevance { score: number; purpose: string; reason: string }

function effectRelevance(s: Situation, e: AbilityEffect, def: AbilityDef): Relevance | null {
  const run = s.run;
  const t = run.t;
  const fx = run.fx;
  const active = run.hydeBrain.active;
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
      return { score: s.chased ? 96 : 78, purpose, reason: `Hyde ${m(d)} away and in ${def.key} range` };
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
      return { score: 86, purpose: 'dash away', reason: `Hyde ${m(d)} behind you; the way ahead is clear` };
    }
    case 'reveal_clues': {
      if (s.threat || run.objective() !== 'find_clues') return null;
      if (t < fx.revealCluesUntil || t < fx.scentUntil) return null;
      const missing = run.map.clues.filter((c) => !run.cluesFound.includes(c.clueId));
      const inRange = missing.filter((c) => e.rangeM <= 0 || Math.hypot(c.x - s.p.x, c.z - s.p.z) <= e.rangeM);
      if (inRange.length === 0) return null;
      return {
        score: 62, purpose: e.visual === 'scent_trail' ? 'follow the scent' : 'reveal nearby evidence',
        reason: `${missing.length} clue${missing.length === 1 ? '' : 's'} still missing, one within range`,
      };
    }
    case 'reveal_hazards':
      if (s.alert && d < 20 && !s.chased && t >= fx.revealHazardsUntil) return { score: 60, purpose: 'outline hiding spots', reason: `Hyde ${MODE_WORD[s.mode]} ${m(d)} away` };
      return null;
    case 'premonition':
      if (!active || s.chased || t < fx.premonitionUntil) return null;
      if (!(s.alert || d < 25)) return null;
      if (e.rangeM > 0 && d > e.rangeM) return null;
      return { score: 64, purpose: 'see where it walks next', reason: `Hyde ${MODE_WORD[s.mode]} ${m(d)} away` };
    case 'power_switch':
      return null; // handled by abilityOption (needs the next-effect fallback rule)
  }
}

/** The best relevant use of ONE of the current duo's abilities, or null when not ready / not relevant / not feasible. */
export function abilityOption(s: Situation, key: 'F' | 'Q', def: AbilityDef, status: AbilityStatus): AdviceOption | null {
  if (!status.ready) return null;
  const run = s.run;
  let best: Relevance | null = null;
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
        if (sw && !run.isWallOpen(sw.gateWallId) && !s.chased) r = { score: 55, purpose: 'open the shortcut gate', reason: 'The gate switch is within reach' };
        if (hasNext) i++; // activation powers the switch; the fallback effect will not apply
      } else if (!hasNext) {
        r = effectRelevance(s, { ...e, kind: 'stun' }, def); // last effect: falls back to a stun with its own numbers
      }
      // not in reach with a next effect: the next effect is the one that applies (evaluated next iteration)
    } else {
      r = effectRelevance(s, e, def);
    }
    if (r && (!best || r.score > best.score)) best = r;
  }
  if (!best) return null;
  return opt(key === 'F' ? 'use_power' : 'use_move', `Press ${key}: ${def.name} to ${best.purpose}`, best.reason, best.score, {
    ability: { key, id: def.id, name: def.name, kinds: kindsOf(def) },
  });
}

// ----------------------------------------------------------------------------------------------------- engine

export class PrescriptiveService {
  readonly engine = ENGINE_LABEL;

  /** Every feasible option, best first. Empty when the run is not in play / accusing. */
  candidates(run: MysteryRun): AdviceOption[] {
    if (run.status === 'accusing') {
      return [opt('review_evidence', 'Review the evidence board (Tab)', 'Weigh what each clue you found actually says', 50)];
    }
    if (run.status !== 'playing') return [];
    const s = situation(run);
    const out: AdviceOption[] = [];
    const p = run.player;
    const d = s.d;
    const nav = run.playerNav();
    const tol = run.tuning.player.interactRangeM + 0.7;

    // ---- the duo's own abilities
    const f = abilityOption(s, 'F', run.power.def, run.powerStatus());
    if (f) out.push(f);
    const q = abilityOption(s, 'Q', run.move.def, run.moveStatus());
    if (q) out.push(q);

    // ---- immediate safety
    if (s.chased) {
      const ev = evadePoint(run);
      out.push(opt('evade', ev ? `Sprint ${dirWord(run, ev.x, ev.z)} and break its line of sight` : 'Sprint away and break its line of sight',
        `It is chasing you, ${m(d)} away`, 90, { target: ev }));
    }
    if (p.stance === 'sprint' && !s.chased) {
      const sprintR = stanceNoiseRadius(run, 'sprint');
      if (d <= sprintR * 1.6) out.push(opt('stop_sprinting', 'Stop sprinting — walk or crouch', `Sprinting is heard ${m(sprintR)} off; Hyde ${m(d)}`, 88));
    }
    if (p.hidden) {
      if (s.alert || (d < 12 && !s.chased)) out.push(opt('stay_quiet', 'Stay hidden and keep still', `Hyde ${MODE_WORD[s.mode]} ${m(d)} away`, 84));
    } else {
      const hideScore = s.chased && d > 4 ? 85 : s.alert && d < 18 ? 82 : (s.mode === 'PATROL' || s.mode === 'COOLDOWN') && s.los && d < 14 ? 70 : 0;
      if (hideScore > 0) {
        const hs = safeHidingSpot(run);
        if (hs) {
          out.push(opt('hide', `Hide: crouch in the ${hs.spot.kind} ${m(hs.distM)} ${dirWord(run, hs.spot.x, hs.spot.z)}`,
            `Hyde ${MODE_WORD[s.mode]} ${m(d)} away`, hideScore, { target: { x: hs.spot.x, z: hs.spot.z } }));
        }
      }
    }
    if (!p.crouched && !s.chased) {
      const walkR = stanceNoiseRadius(run, 'walk');
      if ((s.alert && d < 20) || d < walkR * 2 || (s.los && d < 16)) {
        out.push(opt('crouch', 'Crouch (C) and move slowly', `Hyde ${m(d)} away; walking is heard ${m(walkR)} off`, s.alert ? 80 : 72));
      }
    }

    // ---- objective
    const goal = objectiveTarget(run);
    if (goal && !s.chased && d < 25) {
      const alt = this.alternativeRoute(run, goal, s);
      if (alt) out.push(alt);
    }
    const egg = run.egg;
    if (egg.state === 'carried') {
      const inTower = Math.hypot(p.x - run.map.tower.x, p.z - run.map.tower.z) <= run.map.tower.radius;
      if (inTower) out.push(opt('deposit', 'Hold E here to deposit the egg', "You are inside Iago Tower's circle", s.chased ? 70 : 92, { target: { x: run.map.tower.x, z: run.map.tower.z } }));
      else {
        const dt = navDistance(run, run.map.tower, run.map.tower.radius + 1);
        if (dt !== null) {
          out.push(opt('go_to_tower', 'Carry the egg to Iago Tower', `Tower ${m(dt)} away; egg security ${Math.round(egg.security)}`, s.threat ? 50 : 66, { target: { x: run.map.tower.x, z: run.map.tower.z } }));
        }
      }
    } else if (egg.state === 'dropped') {
      const de = navDistance(run, egg, tol);
      if (de !== null) out.push(opt('retrieve_egg', 'Go back and pick up the egg (E)', `The egg lies ${m(de)} away`, s.threat ? 52 : 70, { target: { x: egg.x, z: egg.z } }));
    } else if (egg.state === 'resting' && run.objective() === 'find_egg') {
      const de = navDistance(run, egg, tol);
      if (de !== null) out.push(opt('get_egg', eggAdvice(run), `All clues found; the egg is ${m(de)} away`, s.threat ? 48 : 64, { target: { x: egg.x, z: egg.z } }));
    }
    if (egg.state !== 'carried' && egg.state !== 'delivered' && run.objective() === 'find_clues') {
      let best: { id: string; x: number; z: number; dist: number } | null = null;
      for (const c of run.map.clues) {
        if (run.cluesFound.includes(c.clueId)) continue;
        if (!nav.reachable(p, c, tol)) continue;
        const dc = navDistance(run, c, tol);
        if (dc === null) continue;
        if (!best || dc < best.dist) best = { id: c.clueId, x: c.x, z: c.z, dist: dc };
      }
      if (best) {
        const found = run.cluesFound.length;
        const total = run.map.clues.length;
        if (best.dist <= 14) {
          out.push(opt('inspect_clue', `Search for evidence ${m(best.dist)} ${dirWord(run, best.x, best.z)}`, `${found} of ${total} clues found so far`, s.threat ? 50 : 68,
            { target: { x: best.x, z: best.z }, clueId: best.id }));
        } else {
          out.push(opt('search_room', `Search the ${roomName(run, best.x, best.z)} for evidence`, `${found} of ${total} clues found so far`, s.threat ? 40 : 60,
            { target: { x: best.x, z: best.z }, clueId: best.id }));
        }
      }
    }
    if (out.length === 0 || out.every((o) => o.score < 20)) {
      out.push(opt('stay_quiet', 'Keep moving quietly', d < 30 ? `Hyde ${MODE_WORD[s.mode]} ${m(d)} away` : 'The Hyde is far away for now', 10));
    }
    return out.sort((a, b) => b.score - a.score || ACTION_ORDER.indexOf(a.action) - ACTION_ORDER.indexOf(b.action));
  }

  /** One concise, feasible suggestion (+ up to two alternatives), or null when nothing applies (run not in play). */
  recommend(run: MysteryRun): Advice | null {
    const all = this.candidates(run);
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

  /** A detour that keeps ≥ 9 m from the Hyde when the direct objective route passes within 6 m of it. */
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
    return opt('alt_route', `Go around via the ${roomName(run, best.via.x, best.via.z)}`, `The direct route passes ${m(closest)} from the Hyde`,
      s.alert ? 76 : 68, { target: best.via });
  }
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

// ----------------------------------------------------------------------------------------------------- follow-up

/** Seconds after the advice within which the action counts as followed. */
export const FOLLOW_WINDOW_S: Record<AdviceAction, number> = {
  evade: 4, hide: 10, crouch: 5, stop_sprinting: 3, alt_route: 10, use_power: 8, use_move: 8, inspect_clue: 30,
  search_room: 45, get_egg: 30, retrieve_egg: 30, go_to_tower: 10, deposit: 10, stay_quiet: 8, review_evidence: 0,
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
      done = ev.some((e) => (e.type === 'clue_search_start' || e.type === 'clue_found') && e.clueId === a.clueId);
      break;
    case 'get_egg':
    case 'retrieve_egg':
      done = ev.some((e) => e.type === 'egg_pickup');
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
    case 'review_evidence':
      return null;
  }
  if (done) return true;
  if (v.nowT >= t1) return false;
  return null; // still open (or the run ended first: "no chance to")
}

/** 'undetected_15s' / 'detected_15s' once 15 s have been observed (or a detection happened), else null. */
export function evaluateOutcome(rec: AdviceRecord, v: FollowView): AdviceRecord['outcome'] {
  const det = detectionTimes(v.events);
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

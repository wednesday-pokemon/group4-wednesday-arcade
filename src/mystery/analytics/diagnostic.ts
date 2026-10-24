// DiagnosticService — "Why?".
//
// Two kinds of statements, never mixed:
//   cause   — asserted ONLY when an explicit sim rule produced a recorded event transition, and the item cites the
//             events (evidenceSeq). Examples: a `noise` the Hyde `hyde_heard` immediately followed by
//             `hyde_mode … reason 'heard_noise'` (hearing rule); `hyde_sighted` then `hyde_mode → CHASE reason
//             'saw_player'` (sight rule); `catch` → `egg_drop reason 'grab'` (grab rule); `egg_damage cause 'impact'`
//             → `egg_drop reason 'impact'` (security threshold rule); `ability_used` → `hyde_mode reason 'stunned' |
//             'lured'`; the second catch → `dnf`.
//             Joseph Crackstone (enemy contract): `crackstone_sighted {via}` → `crackstone_mode → CHASE` with reason
//             saw_player (sight rule: distance + your stance; being seen means you were in his line of sight, not hidden —
//             crouching only shortens his range), sensed_player (proximity rule: within proximityM all around) or scan_hit
//             (scan rule: in the ring with line of sight, not hidden — crouching does not help); `curse {cast}` →
//             `curse {hit}` (you stayed in the ring) / `{hit, blocked}` / `{miss}`; his chase ending by `lost_sight` /
//             `leash` (out of his cursed area) / stun / lure; a landed curse before an `hp_depleted` DNF.
//   pattern — co-occurrence counts, always worded as correlation ("… a pattern, not proof.").
//   case    — why the MYSTERY was not solved, from the case rules (caseLogic.verdictFor): a clue of THIS case never
//             found (named by its case-file title), the wrong suspect, the right suspect with evidence that is not the
//             full chain, no accusation, or a DNF before the accusation. Read from what the run recorded after the
//             accusation (verdict, `correct`, `deductionCorrect`) — never from the answer key, and never naming anyone.
import type { CaseId, HydeMode, NoiseSource, Stance, StampedEvent } from '../types.ts';
import { accusationKind, caseInfo, isCaseId, lastAccusation, recordCaseId } from './caseInfo.ts';
import { ALERT_MODES, stanceAt, stanceSeconds } from './descriptive.ts';
import type { DiagnosticItem, DiagnosticReport, DuoFactors, SessionRecord, TimelineMark } from './types.ts';

type Ev<T extends StampedEvent['type']> = Extract<StampedEvent, { type: T }>;

export interface DiagnoseOptions {
  initialStance?: Stance;
  initialRoom?: string | null;
  factors?: DuoFactors | null;
  /** Room id → display name (defaults to a title-cased id). */
  roomName?: (id: string) => string;
  /** The case played (clue titles for "missed clue"); null / absent = legacy (no clue names). */
  caseId?: CaseId | null;
  /** The run's result when known (verdict / clues / correct) — enough for case reasons without events. */
  result?: SessionRecord['result'];
}

export function fmtT(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function titleCase(id: string): string {
  return id.split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

function m1(x: number): string {
  return `${Math.round(x)} m`;
}

const STANCE_STEP: Record<Stance, string> = {
  sprint: 'sprint (loud)',
  walk: 'walking steps',
  crouch: 'crouched steps',
  idle: 'steps',
};

const SOURCE_TEXT: Record<NoiseSource, string> = {
  hazard: 'A tripped alarm',
  footstep: 'footsteps',
  egg_drop: 'The egg hitting the ground',
  ability: 'Your ability',
  interact: 'Searching / handling',
  impact: 'A collision',
  decoy: 'A decoy',
};

/** Cause priority for the ≤ 3 result rows (higher first). */
const PRIORITY: Record<string, number> = {
  dnf_second_catch: 100, dnf_hp_depleted: 100, catch: 90, catch_blocked: 85, grab_drop: 88, impact_drop: 80,
  seen_on_patrol: 70, seen_while_investigating: 72, seen_while_searching: 71, seen_while_cooling: 70,
  heard_footstep_sprint: 65, heard_footstep_walk: 60, heard_footstep_crouch: 58, heard_footstep_idle: 58,
  heard_egg_drop: 64, heard_ability: 60, heard_interact: 55, heard_impact: 62, heard_decoy: 50,
  glimpse: 50, impact_damage: 45, stunned: 40, lured: 40, chase_lost: 30,
  crack_curse_hit: 87, crack_scan_hit: 69, crack_seen: 68, crack_sensed: 67, crack_curse_blocked: 44, crack_curse_missed: 35,
  crack_leash: 28, crack_lost_sight: 27, crack_stunned: 38, crack_lured: 38,
};

const STANCE_NOTE: Record<Stance, string> = {
  crouch: ' even crouched (crouching only shortens his sight)', sprint: ' sprinting', walk: ' walking', idle: ' standing still',
};

export function causePriority(code: string): number {
  return PRIORITY[code] ?? 10;
}

function abilityName(e: Ev<'ability_used'>, f: DuoFactors | null | undefined): string {
  if (f) {
    if (e.key === 'F' && f.power.id === e.abilityId) return f.power.name;
    if (e.key === 'Q' && f.move.id === e.abilityId) return f.move.name;
  }
  return `${e.key} ability`;
}

/** Latest event of `type` before index i satisfying pred (scanning back at most `limit` events). */
function findBack<T extends StampedEvent['type']>(ev: readonly StampedEvent[], i: number, type: T, pred: (e: Ev<T>) => boolean = () => true, limit = 50): { e: Ev<T>; i: number } | null {
  for (let j = i - 1; j >= 0 && j >= i - limit; j--) {
    const e = ev[j];
    if (e.type === type && pred(e as Ev<T>)) return { e: e as Ev<T>, i: j };
  }
  return null;
}

function findForward<T extends StampedEvent['type']>(ev: readonly StampedEvent[], i: number, type: T, pred: (e: Ev<T>) => boolean = () => true, limit = 8): { e: Ev<T>; i: number } | null {
  for (let j = i + 1; j < ev.length && j <= i + limit; j++) {
    const e = ev[j];
    if (e.type === type && pred(e as Ev<T>)) return { e: e as Ev<T>, i: j };
  }
  return null;
}

/** The noise + hearing that a `hyde_mode … heard_noise` transition at index i was triggered by (same instant). */
function heardChain(ev: readonly StampedEvent[], i: number): { heard: Ev<'hyde_heard'>; noise: Ev<'noise'> | null } | null {
  const mode = ev[i];
  const h = findBack(ev, i, 'hyde_heard', (e) => e.t === mode.t, 6);
  if (!h) return null;
  const n = findBack(ev, h.i, 'noise', (e) => e.t === h.e.t && e.source === h.e.source, 6);
  return { heard: h.e, noise: n?.e ?? null };
}

const MODE_WORD: Record<HydeMode, string> = {
  PATROL: 'on patrol', INVESTIGATE_SOUND: 'investigating a noise', SEARCH: 'searching', CHASE: 'chasing', COOLDOWN: 'losing interest',
};

/** Rule-verified causes for one session. */
export function diagnoseCauses(events: readonly StampedEvent[], o: DiagnoseOptions = {}): DiagnosticItem[] {
  const ev = events;
  const out: DiagnosticItem[] = [];
  const init = o.initialStance ?? 'idle';
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e.type === 'hyde_mode') {
      if (e.to === 'INVESTIGATE_SOUND' && e.reason === 'heard_noise') {
        const chain = heardChain(ev, i);
        if (!chain) continue;
        const { heard, noise } = chain;
        const evidence = [noise?.seq, heard.seq, e.seq].filter((s): s is number => typeof s === 'number');
        if (heard.source === 'footstep') {
          const st = stanceAt(ev, e.t, init);
          if (st.seq !== null) evidence.unshift(st.seq);
          out.push({
            t: e.t, kind: 'cause', code: `heard_footstep_${st.stance}`, evidenceSeq: evidence,
            text: `${fmtT(e.t)} · Your ${STANCE_STEP[st.stance]} ${st.stance === 'sprint' ? 'was' : 'were'} heard ${m1(heard.distanceM)} away → the Hyde investigated.`,
          });
        } else if (heard.source === 'ability') {
          const used = findBack(ev, i, 'ability_used', (u) => u.t === e.t, 10);
          if (used) evidence.unshift(used.e.seq);
          out.push({
            t: e.t, kind: 'cause', code: 'heard_ability', evidenceSeq: evidence,
            text: `${fmtT(e.t)} · ${used ? abilityName(used.e, o.factors) : 'Your ability'} made noise, heard ${m1(heard.distanceM)} away → the Hyde investigated.`,
          });
        } else {
          out.push({
            t: e.t, kind: 'cause', code: `heard_${heard.source}`, evidenceSeq: evidence,
            text: `${fmtT(e.t)} · ${SOURCE_TEXT[heard.source]} was heard ${m1(heard.distanceM)} away → the Hyde investigated.`,
          });
        }
      } else if (e.reason === 'saw_player') {
        const seen = findBack(ev, i, 'hyde_sighted', () => true, 400);
        // the sighting must still be current: no hyde_lost between it and the transition
        const lost = seen ? ev.slice(seen.i + 1, i).some((x) => x.type === 'hyde_lost') : true;
        if (!seen || lost) continue;
        const st = stanceAt(ev, seen.e.t, init);
        const stanceNote = st.stance === 'crouch' ? ' (you were crouched)' : st.stance === 'sprint' ? ' (you were sprinting)' : '';
        if (e.to === 'CHASE') {
          const code = e.from === 'INVESTIGATE_SOUND' ? 'seen_while_investigating' : e.from === 'SEARCH' ? 'seen_while_searching' : e.from === 'COOLDOWN' ? 'seen_while_cooling' : 'seen_on_patrol';
          out.push({
            t: e.t, kind: 'cause', code, evidenceSeq: [seen.e.seq, e.seq],
            text: `${fmtT(e.t)} · While ${MODE_WORD[e.from]}, it saw you ${m1(seen.e.distanceM)} away${stanceNote} → chase.`,
          });
        } else if (e.to === 'INVESTIGATE_SOUND') {
          out.push({
            t: e.t, kind: 'cause', code: 'glimpse', evidenceSeq: [seen.e.seq, e.seq],
            text: `${fmtT(e.t)} · It glimpsed you ${m1(seen.e.distanceM)} away → it came to look.`,
          });
        }
      } else if (e.reason === 'stunned' || e.reason === 'lured') {
        const used = findBack(ev, i, 'ability_used', (u) => u.t === e.t, 10);
        if (!used) continue;
        out.push({
          t: e.t, kind: 'cause', code: e.reason, evidenceSeq: [used.e.seq, e.seq],
          text: e.reason === 'stunned'
            ? `${fmtT(e.t)} · Your ${abilityName(used.e, o.factors)} stopped the Hyde → it lost track of you.`
            : `${fmtT(e.t)} · Your ${abilityName(used.e, o.factors)} lured the Hyde to a decoy.`,
        });
      } else if (e.from === 'CHASE' && e.reason === 'lost_sight') {
        out.push({
          t: e.t, kind: 'cause', code: 'chase_lost', evidenceSeq: [e.seq],
          text: `${fmtT(e.t)} · It lost sight of you long enough → the chase became a search.`,
        });
      }
    } else if (e.type === 'catch') {
      const evidence = [e.seq];
      const onset = findBack(ev, i, 'hyde_mode', (m) => m.to === 'CHASE', 2000);
      if (onset) evidence.unshift(onset.e.seq);
      out.push({
        t: e.t, kind: 'cause', code: e.blocked ? 'catch_blocked' : 'catch', evidenceSeq: evidence,
        text: e.blocked
          ? `${fmtT(e.t)} · Caught (${e.catchNumber} of 2) — the block absorbed the damage; the catch still counts.`
          : `${fmtT(e.t)} · The chase ended in a grab: caught ${e.catchNumber} of 2, −${e.hpLost} HP.`,
      });
      const drop = findForward(ev, i, 'egg_drop', (d) => d.reason === 'grab' && d.t === e.t);
      if (drop) {
        const dmg = findForward(ev, i, 'egg_damage', (d) => d.cause === 'grab' && d.t === e.t);
        out.push({
          t: e.t, kind: 'cause', code: 'grab_drop', evidenceSeq: [e.seq, ...(dmg ? [dmg.e.seq] : []), drop.e.seq],
          text: `${fmtT(e.t)} · The grab cost ${e.eggSecurityLost} egg security and knocked the egg loose.`,
        });
      }
    } else if (e.type === 'egg_damage' && e.cause === 'impact') {
      const drop = findForward(ev, i, 'egg_drop', (d) => d.reason === 'impact' && d.t === e.t);
      out.push(drop
        ? { t: e.t, kind: 'cause', code: 'impact_drop', evidenceSeq: [e.seq, drop.e.seq], text: `${fmtT(e.t)} · A hard collision cost ${e.amount} security → the egg dropped.` }
        : { t: e.t, kind: 'cause', code: 'impact_damage', evidenceSeq: [e.seq], text: `${fmtT(e.t)} · A collision while carrying cost ${e.amount} egg security.` });
    } else if (e.type === 'crackstone_mode') {
      crackCause(ev, i, e, init, o, out);
    } else if (e.type === 'curse' && e.phase !== 'cast') {
      const cast = findBack(ev, i, 'curse', (c) => c.phase === 'cast', 200);
      if (!cast) continue;
      const evidence = [cast.e.seq, e.seq];
      if (e.phase === 'hit') {
        out.push(e.blocked
          ? { t: e.t, kind: 'cause', code: 'crack_curse_blocked', evidenceSeq: evidence, text: `${fmtT(e.t)} · The curse landed on you, but your block absorbed it — no damage.` }
          : { t: e.t, kind: 'cause', code: 'crack_curse_hit', evidenceSeq: evidence, text: `${fmtT(e.t)} · Crackstone's curse landed: you stayed in the ring → −${e.hpLost} HP and slowed.` });
      } else {
        out.push({
          t: e.t, kind: 'cause', code: 'crack_curse_missed', evidenceSeq: evidence,
          text: `${fmtT(e.t)} · The curse missed: you were out of the ring, hidden or out of his line of sight when it landed (or he was stopped).`,
        });
      }
    } else if (e.type === 'dnf') {
      const lastCatch = e.reason === 'hp_depleted'
        ? findBack(ev, i, 'catch', () => true, 20) ?? findBack(ev, i, 'curse', (c) => c.phase === 'hit', 20)
        : findBack(ev, i, 'catch', () => true, 20);
      out.push({
        t: e.t, kind: 'cause', code: `dnf_${e.reason}`, evidenceSeq: [...(lastCatch ? [lastCatch.e.seq] : []), e.seq],
        text: e.reason === 'second_catch' ? `${fmtT(e.t)} · The second catch ended the run.` : `${fmtT(e.t)} · HP ran out → the run ended.`,
      });
    }
  }
  return out;
}

/** Crackstone mode transitions with a rule cause (chase onset by sight / proximity / scan, chase end, stun / lure). */
function crackCause(ev: readonly StampedEvent[], i: number, e: Ev<'crackstone_mode'>, init: Stance, o: DiagnoseOptions, out: DiagnosticItem[]): void {
  const engaged = (m: string) => m === 'CHASE' || m === 'ATTACK';
  if (e.to === 'CHASE' && e.from !== 'ATTACK' && (e.reason === 'saw_player' || e.reason === 'sensed_player' || e.reason === 'scan_hit')) {
    const via = e.reason === 'saw_player' ? 'sight' : e.reason === 'sensed_player' ? 'proximity' : 'scan';
    const seen = findBack(ev, i, 'crackstone_sighted', (x) => x.via === via, 400);
    if (!seen) return;
    // a sight / proximity detection must still be current: no crackstone_lost between it and the transition
    if (via !== 'scan' && ev.slice(seen.i + 1, i).some((x) => x.type === 'crackstone_lost')) return;
    const st = stanceAt(ev, seen.e.t, init);
    const d = m1(seen.e.distanceM);
    if (via === 'sight') {
      out.push({
        t: e.t, kind: 'cause', code: 'crack_seen', evidenceSeq: [seen.e.seq, e.seq],
        text: `${fmtT(e.t)} · Crackstone saw you ${d} away${STANCE_NOTE[st.stance]}, in his line of sight and not hidden → he hunted you.`,
      });
    } else if (via === 'proximity') {
      out.push({
        t: e.t, kind: 'cause', code: 'crack_sensed', evidenceSeq: [seen.e.seq, e.seq],
        text: `${fmtT(e.t)} · You came within ${d} of Crackstone — he senses anyone that close, all around → he hunted you.`,
      });
    } else {
      const scan = findBack(ev, i, 'crackstone_scan', (x) => x.phase === 'pulse' && x.hit, 20);
      out.push({
        t: e.t, kind: 'cause', code: 'crack_scan_hit', evidenceSeq: [...(scan ? [scan.e.seq] : []), seen.e.seq, e.seq],
        text: `${fmtT(e.t)} · His scan found you ${d} away: inside the ring, no wall between you, not hidden${st.stance === 'crouch' ? ' (crouching does not stop a scan)' : ''} → he hunted you.`,
      });
    }
    void o;
    return;
  }
  if (engaged(e.from) && !engaged(e.to)) {
    if (e.reason === 'leash') {
      out.push({ t: e.t, kind: 'cause', code: 'crack_leash', evidenceSeq: [e.seq], text: `${fmtT(e.t)} · You got out of his cursed area → Crackstone gave up the chase (he never leaves it).` });
    } else if (e.reason === 'lost_sight') {
      out.push({ t: e.t, kind: 'cause', code: 'crack_lost_sight', evidenceSeq: [e.seq], text: `${fmtT(e.t)} · Crackstone lost sight of you long enough → he gave up the chase and searched.` });
    } else if (e.reason === 'stunned' || e.reason === 'lured') {
      const used = findBack(ev, i, 'ability_used', (u) => u.t === e.t, 10);
      if (!used) return;
      out.push({
        t: e.t, kind: 'cause', code: e.reason === 'stunned' ? 'crack_stunned' : 'crack_lured', evidenceSeq: [used.e.seq, e.seq],
        text: e.reason === 'stunned' ? `${fmtT(e.t)} · Your ${abilityName(used.e, o.factors)} stopped Crackstone → he lost track of you.` : `${fmtT(e.t)} · Your ${abilityName(used.e, o.factors)} lured Crackstone to a decoy.`,
      });
    }
  }
}

/** [from, to] stance intervals covering 0..endT. */
export function stanceIntervals(events: readonly StampedEvent[], endT: number, initial: Stance = 'idle'): { stance: Stance; from: number; to: number }[] {
  const out: { stance: Stance; from: number; to: number }[] = [];
  let cur = initial;
  let since = 0;
  for (const e of events) {
    if (e.type !== 'stance') continue;
    out.push({ stance: cur, from: since, to: e.t });
    cur = e.stance;
    since = e.t;
  }
  out.push({ stance: cur, from: since, to: Math.max(since, endT) });
  return out.filter((x) => x.to > x.from || x === out[out.length - 1]);
}

/** Sightings and those that came while / within `windowS` after sprinting. */
export function sightingsNearSprint(events: readonly StampedEvent[], initial: Stance = 'idle', windowS = 5): { near: Ev<'hyde_sighted'>[]; total: number } {
  const endT = events[events.length - 1]?.t ?? 0;
  const sprints = stanceIntervals(events, endT, initial).filter((x) => x.stance === 'sprint');
  const sightings = events.filter((e): e is Ev<'hyde_sighted'> => e.type === 'hyde_sighted');
  const near = sightings.filter((s) => sprints.some((x) => x.from <= s.t && x.to >= s.t - windowS));
  return { near, total: sightings.length };
}

/** Labelled correlations for one session (never causal wording). */
export function diagnosePatterns(events: readonly StampedEvent[], o: DiagnoseOptions = {}): DiagnosticItem[] {
  const ev = events;
  const out: DiagnosticItem[] = [];
  const init = o.initialStance ?? 'idle';
  const roomName = o.roomName ?? titleCase;
  const endT = ev[ev.length - 1]?.t ?? 0;
  const sp = sightingsNearSprint(ev, init);
  if (sp.total >= 2 && sp.near.length > 0) {
    out.push({
      t: sp.near[0].t, kind: 'pattern', code: 'sprint_before_sighting', evidenceSeq: sp.near.map((s) => s.seq),
      text: `${sp.near.length} of ${sp.total} sightings came within 5 s of sprinting — a pattern, not proof.`,
    });
  }
  // alerts while carrying the egg
  const alerts: { e: StampedEvent; carrying: boolean; room: string | null }[] = [];
  let carrying = false;
  let room = o.initialRoom ?? null;
  for (const e of ev) {
    if (e.type === 'egg_pickup') carrying = true;
    else if (e.type === 'egg_drop' || e.type === 'egg_delivered') carrying = false;
    else if (e.type === 'room_enter') room = e.roomId;
    else if (e.type === 'hyde_mode' && ALERT_MODES.includes(e.to) && e.from !== 'CHASE' && (e.reason === 'heard_noise' || e.reason === 'saw_player')) {
      alerts.push({ e, carrying, room });
    }
  }
  const carried = alerts.filter((a) => a.carrying);
  const pickup = ev.find((e) => e.type === 'egg_pickup');
  if (alerts.length >= 2 && carried.length >= 1 && pickup) {
    out.push({
      t: carried[0].e.t, kind: 'pattern', code: 'alerts_while_carrying', evidenceSeq: carried.map((a) => a.e.seq),
      text: `${carried.length} of ${alerts.length} alerts came while you carried the egg — a pattern, not proof.`,
    });
  }
  // room concentration
  const byRoom = new Map<string, typeof alerts>();
  for (const a of alerts) if (a.room) byRoom.set(a.room, [...(byRoom.get(a.room) ?? []), a]);
  let topRoom: [string, typeof alerts] | null = null;
  for (const entry of byRoom) if (!topRoom || entry[1].length > topRoom[1].length) topRoom = entry;
  if (topRoom && alerts.length >= 3 && topRoom[1].length >= 2 && topRoom[1].length / alerts.length >= 0.6) {
    out.push({
      t: topRoom[1][0].e.t, kind: 'pattern', code: 'alerts_room', evidenceSeq: topRoom[1].map((a) => a.e.seq),
      text: `${topRoom[1].length} of ${alerts.length} alerts happened in the ${roomName(topRoom[0])} — a pattern, not proof.`,
    });
  }
  // detections while crouched vs time crouched
  const detections = ev.filter((e) => e.type === 'hyde_mode' && e.to === 'CHASE');
  if (detections.length >= 2 && endT > 0) {
    const st = stanceSeconds(ev, endT, init);
    const total = st.idle + st.walk + st.crouch + st.sprint;
    const crouchShare = total > 0 ? st.crouch / total : 0;
    const crouchedDet = detections.filter((d) => stanceAt(ev, d.t, init).stance === 'crouch');
    if (crouchShare >= 0.2) {
      out.push({
        t: detections[0].t, kind: 'pattern', code: 'crouch_vs_detections', evidenceSeq: detections.map((d) => d.seq),
        text: `${crouchedDet.length} of ${detections.length} chases began while crouched; you crouched ${Math.round(crouchShare * 100)}% of the time — a correlation, not proof.`,
      });
    }
  }
  return out;
}

export function buildTimeline(events: readonly StampedEvent[]): TimelineMark[] {
  const out: TimelineMark[] = [];
  for (const e of events) {
    let kind: TimelineMark['kind'] | null = null;
    switch (e.type) {
      case 'hyde_heard': kind = 'heard'; break;
      case 'hyde_mode': kind = e.to === 'INVESTIGATE_SOUND' ? 'investigate' : e.to === 'SEARCH' ? 'search' : e.to === 'CHASE' ? 'chase' : null; break;
      case 'catch': kind = 'catch'; break;
      case 'clue_found': kind = 'clue'; break;
      case 'egg_pickup': kind = 'egg_pickup'; break;
      case 'egg_drop': kind = 'egg_drop'; break;
      case 'egg_delivered': kind = 'deposit'; break;
      case 'ability_used': kind = 'ability'; break;
      case 'hint_requested': kind = 'hint'; break;
      case 'finish': case 'dnf': kind = 'end'; break;
      default: break;
    }
    if (kind) out.push({ t: e.t, kind, seq: e.seq });
  }
  return out;
}

// ----------------------------------------------------------------------------------------------------- case reasons

/** Short aggregate labels for the case-reason codes (dashboard). */
export const CASE_REASON_TEXT: Record<string, string> = {
  missed_clue: 'Missed a clue',
  wrong_suspect: 'Accused the wrong suspect',
  weak_evidence: 'Right suspect, evidence not the full chain',
  not_accused: 'Left the case without an accusation',
  unsolved: 'Accusation did not solve the case (detail unknown)',
  dnf_before_accusation: 'Run ended before the accusation',
};

/**
 * Why the case was not solved (empty when it was solved or the run is still going). Works from events alone, from
 * the result alone (anonymous live rows) or both. Items are ordered: the accusation outcome first, then each clue of
 * the case that was never found.
 */
export function diagnoseCaseReasons(events: readonly StampedEvent[], o: DiagnoseOptions = {}): DiagnosticItem[] {
  const kind = accusationKind({ events, result: o.result ?? undefined });
  if (kind === 'solved' || kind === 'pending') return [];
  const caseId = o.caseId && isCaseId(o.caseId) ? o.caseId : null;
  const info = caseId ? caseInfo(caseId) : null;
  const acc = lastAccusation(events);
  let terminal: StampedEvent | null = null;
  for (const e of events) if (e.type === 'finish' || e.type === 'dnf') terminal = e;
  const t = acc?.t ?? terminal?.t ?? o.result?.activeTimeS ?? 0;
  const evidence = [acc?.seq, terminal?.seq].filter((x): x is number => typeof x === 'number');
  const name = info ? `Case ${info.number} · ${info.title}` : 'the case';
  const at = `${fmtT(t)} · `;
  const out: DiagnosticItem[] = [];
  const push = (code: string, text: string, extra: Partial<DiagnosticItem> = {}) => out.push({ t, kind: 'case', code, text, evidenceSeq: evidence, ...extra });
  switch (kind) {
    case 'dnf':
      push('dnf_before_accusation', `${at}The run ended before the accusation, so ${name} stayed open.`);
      break;
    case 'not_accused':
      push('not_accused', `${at}No suspect was accused, so ${name} was left unsolved.`);
      break;
    case 'wrong_suspect':
      push('wrong_suspect', `${at}The accused suspect was not the culprit of ${name}.`);
      break;
    case 'right_suspect_wrong_evidence':
      push('weak_evidence', `${at}Right suspect, but the cited evidence was not the full chain (method, opportunity, broken alibi).`);
      break;
    case 'unsolved':
      push('unsolved', `${at}The accusation did not solve ${name}.`);
      break;
  }
  if (info) {
    const found = new Set<string>(o.result?.cluesFound ?? events.filter((e) => e.type === 'clue_found').map((e) => (e as Extract<StampedEvent, { type: 'clue_found' }>).clueId));
    for (const c of info.clues) {
      if (found.has(c.id)) continue;
      push('missed_clue', `${at}Missed clue: “${c.title}” (${c.location}). A solved case needs all ${info.clues.length}.`, { ref: c.id });
    }
  }
  return out;
}

export function diagnoseSession(events: readonly StampedEvent[], o: DiagnoseOptions = {}): DiagnosticReport {
  return {
    timeline: buildTimeline(events), causes: diagnoseCauses(events, o), patterns: diagnosePatterns(events, o),
    caseReasons: diagnoseCaseReasons(events, o),
  };
}

/** Stealth causes that count as mistakes (they led to an alert, a catch, an egg drop or the DNF). */
const MISTAKE = /^(heard_|seen_|glimpse$|catch$|catch_blocked$|grab_drop$|impact_drop$|impact_damage$|dnf_|crack_seen$|crack_sensed$|crack_scan_hit$|crack_curse_hit$)/;

/**
 * Reasons this run fell short, for the results panel: the case-rule reasons (incorrect deduction, missed clues) plus
 * the most important stealth mistakes (rule-verified causes). Empty for a clean solved run.
 */
export function failureReasons(rep: DiagnosticReport, nStealth = 2): DiagnosticItem[] {
  const stealth = topCauses(rep.causes.filter((c) => MISTAKE.test(c.code)), nStealth);
  return [...rep.caseReasons, ...stealth];
}

/** The `n` most important causes, in time order (for the ≤ 3 rows of the results panel). */
export function topCauses(items: readonly DiagnosticItem[], n = 3): DiagnosticItem[] {
  return [...items]
    .filter((x) => x.kind === 'cause')
    .sort((a, b) => causePriority(b.code) - causePriority(a.code) || a.t - b.t)
    .slice(0, n)
    .sort((a, b) => a.t - b.t);
}

// ----------------------------------------------------------------------------------------------------- aggregate

export interface FailureCause { code: string; text: string; count: number; sessions: number }

export interface CaseFailure { code: string; text: string; count: number; caseId: CaseId | null; ref?: string }

export interface DiagnosticAggregate {
  /** Rule-verified chains behind catches / DNFs across sessions, most frequent first. */
  failureCauses: FailureCause[];
  /**
   * Why cases were not solved (case rules), most frequent first: the accusation outcome codes (wrong suspect, weak
   * evidence, not accused, DNF before accusing) and every missed clue by its case-file title. Never names anyone.
   */
  caseFailures: CaseFailure[];
  /** Ended runs whose case was not solved (denominator for caseFailures). */
  unsolvedRuns: number;
  dnfReasons: Record<string, number>;
  /** Pooled correlations, each labelled as such. */
  patterns: { code: string; text: string; numerator: number; denominator: number }[];
}

const CHAIN_TEXT: Record<string, string> = {
  seen_on_patrol: 'Seen by the patrolling Hyde → chase → caught',
  seen_while_searching: 'Seen while it searched → chase → caught',
  seen_while_cooling: 'Seen while it lost interest → chase → caught',
  seen_while_investigating: 'Seen while it investigated → chase → caught',
  unknown: 'Caught (chain not in the uploaded events)',
};

const HEARD_TEXT: Record<string, string> = {
  heard_footstep_sprint: 'Sprint heard',
  heard_footstep_walk: 'Walking heard',
  heard_footstep_crouch: 'Crouched steps heard',
  heard_footstep_idle: 'Steps heard',
  heard_egg_drop: 'Egg drop heard',
  heard_ability: 'Ability noise heard',
  heard_interact: 'Search noise heard',
  heard_impact: 'Collision heard',
  heard_decoy: 'Decoy heard',
};

/** Classifies every catch by its rule-verified chain (what started the chase that ended in the grab). */
export function catchChains(events: readonly StampedEvent[], o: DiagnoseOptions = {}): { code: string; text: string; seq: number }[] {
  const causes = diagnoseCauses(events, o);
  const out: { code: string; text: string; seq: number }[] = [];
  for (const c of causes) {
    if (c.code !== 'catch' && c.code !== 'catch_blocked') continue;
    const catchSeq = c.evidenceSeq[c.evidenceSeq.length - 1];
    const onsetSeq = c.evidenceSeq.length > 1 ? c.evidenceSeq[0] : null;
    const onset = onsetSeq !== null ? causes.find((x) => x.evidenceSeq.includes(onsetSeq) && x.code.startsWith('seen_')) : undefined;
    if (!onset) {
      out.push({ code: 'unknown', text: CHAIN_TEXT.unknown, seq: catchSeq });
      continue;
    }
    let code = onset.code;
    let text = CHAIN_TEXT[onset.code] ?? CHAIN_TEXT.unknown;
    if (onset.code === 'seen_while_investigating') {
      // what started that investigation (the latest heard/glimpse cause before the onset)
      const before = causes.filter((x) => x.t <= onset.t && (x.code.startsWith('heard_') || x.code === 'glimpse'));
      const trigger = before[before.length - 1];
      if (trigger && trigger.code.startsWith('heard_')) {
        code = `${trigger.code}>seen>caught`;
        text = `${HEARD_TEXT[trigger.code] ?? 'Noise heard'} → investigated → saw you → caught`;
      }
    }
    out.push({ code, text, seq: catchSeq });
  }
  return out;
}

export function aggregateDiagnostics(records: readonly SessionRecord[]): DiagnosticAggregate {
  const counts = new Map<string, FailureCause>();
  const caseCounts = new Map<string, CaseFailure>();
  let unsolvedRuns = 0;
  for (const r of records) {
    const caseId = recordCaseId(r);
    const reasons = diagnoseCaseReasons(r.events, { caseId, result: r.result });
    if (reasons.length > 0) unsolvedRuns++;
    for (const it of reasons) {
      const key = it.code === 'missed_clue' ? `missed_clue:${it.ref}` : it.code;
      const info = caseId ? caseInfo(caseId) : null;
      const clue = it.ref && info ? info.clues.find((c) => c.id === it.ref) : undefined;
      const text = clue && info ? `Missed “${clue.title}” (Case ${info.number})` : (CASE_REASON_TEXT[it.code] ?? it.code);
      const c = caseCounts.get(key) ?? { code: it.code, text, count: 0, caseId: it.code === 'missed_clue' ? caseId : null, ...(it.ref ? { ref: it.ref } : {}) };
      c.count++;
      caseCounts.set(key, c);
    }
  }
  const dnfReasons: Record<string, number> = {};
  let sightings = 0;
  let sightingsAfterSprint = 0;
  let alerts = 0;
  let alertsCarrying = 0;
  let carryTime = 0;
  let totalTime = 0;
  for (const r of records) {
    const seen = new Set<string>();
    for (const ch of catchChains(r.events)) {
      const c = counts.get(ch.code) ?? { code: ch.code, text: ch.text, count: 0, sessions: 0 };
      c.count++;
      if (!seen.has(ch.code)) {
        c.sessions++;
        seen.add(ch.code);
      }
      counts.set(ch.code, c);
    }
    for (const e of r.events) if (e.type === 'dnf') dnfReasons[e.reason] = (dnfReasons[e.reason] ?? 0) + 1;
    const sp = sightingsNearSprint(r.events);
    sightings += sp.total;
    sightingsAfterSprint += sp.near.length;
    // carrying share of time vs share of alerts
    let carrying = false;
    let since = 0;
    for (const e of r.events) {
      if (e.type === 'egg_pickup') {
        carrying = true;
        since = e.t;
      } else if ((e.type === 'egg_drop' || e.type === 'egg_delivered') && carrying) {
        carrying = false;
        carryTime += e.t - since;
      } else if (e.type === 'hyde_mode' && ALERT_MODES.includes(e.to) && e.from !== 'CHASE' && (e.reason === 'heard_noise' || e.reason === 'saw_player')) {
        alerts++;
        if (carrying) alertsCarrying++;
      }
    }
    const end = r.result?.activeTimeS ?? r.events[r.events.length - 1]?.t ?? 0;
    if (carrying) carryTime += Math.max(0, end - since);
    totalTime += end;
  }
  const patterns: DiagnosticAggregate['patterns'] = [];
  if (sightings > 0) {
    patterns.push({
      code: 'sprint_before_sighting', numerator: sightingsAfterSprint, denominator: sightings,
      text: `${sightingsAfterSprint} of ${sightings} sightings came within 5 s of sprinting — correlation, not proof.`,
    });
  }
  if (alerts > 0 && totalTime > 0) {
    patterns.push({
      code: 'alerts_while_carrying', numerator: alertsCarrying, denominator: alerts,
      text: `${alertsCarrying} of ${alerts} alerts came while carrying the egg (${Math.round((100 * carryTime) / totalTime)}% of play time) — correlation, not proof.`,
    });
  }
  return {
    failureCauses: [...counts.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    caseFailures: [...caseCounts.values()].sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)),
    unsolvedRuns,
    dnfReasons,
    patterns,
  };
}

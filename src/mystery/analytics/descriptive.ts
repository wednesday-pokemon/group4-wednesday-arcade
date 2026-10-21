// DescriptiveService — "What happened?". Exact counts from the immutable event log (+ 1 Hz samples for the initial
// stance and the per-frame distance when tracked). One session → SessionReport; many sessions → the Laptop 1 aggregate.
import type { Duo, HydeMode, NoiseSource, RunResult, Stance, StampedEvent, Verdict } from '../types.ts';
import type { TelemetryCollector } from './telemetry.ts';
import type { AbilityUse, DuoFactors, SessionRecord, SessionReport, StanceTimes } from './types.ts';

export const NOISE_SOURCES: readonly NoiseSource[] = ['footstep', 'egg_drop', 'ability', 'interact', 'impact', 'decoy'];
export const HYDE_MODES: readonly HydeMode[] = ['PATROL', 'INVESTIGATE_SOUND', 'SEARCH', 'CHASE', 'COOLDOWN'];
export const ALERT_MODES: readonly HydeMode[] = ['INVESTIGATE_SOUND', 'SEARCH', 'CHASE'];
const STANCES: readonly Stance[] = ['idle', 'walk', 'crouch', 'sprint'];

export interface DescribeInput {
  duo: Duo;
  events: readonly StampedEvent[];
  initialStance?: Stance;
  /** Active seconds at the end of the observed run (defaults to result / last event). */
  endT?: number;
  distanceM?: number | null;
  result?: RunResult | null;
  factors?: DuoFactors | null;
  totalClues?: number;
}

function zeroRecord<K extends string>(keys: readonly K[]): Record<K, number> {
  const o = {} as Record<K, number>;
  for (const k of keys) o[k] = 0;
  return o;
}

/** Seconds spent in each stance between 0 and endT, from `stance` change events. */
export function stanceSeconds(events: readonly StampedEvent[], endT: number, initial: Stance = 'idle'): StanceTimes {
  const out = zeroRecord(STANCES) as StanceTimes;
  let cur: Stance = initial;
  let since = 0;
  for (const e of events) {
    if (e.type !== 'stance') continue;
    const t = Math.min(e.t, endT);
    out[cur] += Math.max(0, t - since);
    cur = e.stance;
    since = t;
  }
  out[cur] += Math.max(0, endT - since);
  for (const s of STANCES) out[s] = Math.round(out[s] * 1000) / 1000;
  return out;
}

export function shares(times: StanceTimes): StanceTimes {
  const total = STANCES.reduce((s, k) => s + times[k], 0);
  const out = zeroRecord(STANCES) as StanceTimes;
  if (total <= 0) return out;
  for (const k of STANCES) out[k] = times[k] / total;
  return out;
}

/** Stance at time t (the last stance event at or before t). */
export function stanceAt(events: readonly StampedEvent[], t: number, initial: Stance = 'idle'): { stance: Stance; seq: number | null } {
  let cur: Stance = initial;
  let seq: number | null = null;
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === 'stance') {
      cur = e.stance;
      seq = e.seq;
    }
  }
  return { stance: cur, seq };
}

export function describeSession(input: DescribeInput): SessionReport {
  const ev = input.events;
  const result = input.result ?? null;
  const last = ev[ev.length - 1];
  const terminal = ev.find((e) => e.type === 'finish' || e.type === 'dnf');
  const status: SessionReport['status'] = result ? result.outcome : terminal ? (terminal.type === 'finish' ? 'finished' : 'dnf') : 'in_progress';
  const deliveredEv = ev.find((e) => e.type === 'egg_delivered');
  const endT = input.endT ?? result?.activeTimeS ?? (deliveredEv ? deliveredEv.t : (last?.t ?? 0));

  const noiseBy = zeroRecord(NOISE_SOURCES);
  const heardBy = zeroRecord(NOISE_SOURCES);
  const alerts = zeroRecord(HYDE_MODES);
  let maxLoud = 0;
  let noiseTotal = 0;
  let heard = 0;
  let sightings = 0;
  let catches = 0;
  let blocked = 0;
  let hpLost = 0;
  let firstAlertT: number | null = null;
  const found: { clueId: string; t: number }[] = [];
  let pickupT: number | null = null;
  const drops: SessionReport['egg']['drops'] = [];
  let securityLost = 0;
  let security: number | null = null;
  let delivered = false;
  let deliveredT: number | null = null;
  let points = 0;
  const F: AbilityUse = { uses: 0, successes: 0, denied: 0, name: input.factors?.power.name ?? null };
  const Q: AbilityUse = { uses: 0, successes: 0, denied: 0, name: input.factors?.move.name ?? null };
  let hints = 0;
  let verdict: Verdict | null = null;
  let score: number | null = null;

  for (const e of ev) {
    switch (e.type) {
      case 'noise':
        noiseTotal++;
        noiseBy[e.source]++;
        if (e.loudness > maxLoud) maxLoud = e.loudness;
        break;
      case 'hyde_heard':
        heard++;
        heardBy[e.source]++;
        break;
      case 'hyde_mode':
        alerts[e.to]++;
        if (firstAlertT === null && ALERT_MODES.includes(e.to)) firstAlertT = e.t;
        break;
      case 'hyde_sighted':
        sightings++;
        break;
      case 'catch':
        catches++;
        if (e.blocked) blocked++;
        hpLost += e.hpLost;
        break;
      case 'clue_found':
        found.push({ clueId: e.clueId, t: e.t });
        break;
      case 'egg_pickup':
        if (pickupT === null) pickupT = e.t;
        break;
      case 'egg_drop':
        drops.push({ t: e.t, reason: e.reason });
        security = e.security;
        break;
      case 'egg_damage':
        securityLost += e.amount;
        security = e.security;
        break;
      case 'egg_delivered':
        delivered = true;
        deliveredT = e.t;
        points = e.points;
        security = e.security;
        break;
      case 'ability_used': {
        const u = e.key === 'F' ? F : Q;
        u.uses++;
        if (e.success) u.successes++;
        break;
      }
      case 'ability_denied':
        (e.key === 'F' ? F : Q).denied++;
        break;
      case 'hint_requested':
        hints++;
        break;
      case 'finish':
        verdict = e.verdict;
        score = e.score;
        break;
      default:
        break;
    }
  }
  const stance = stanceSeconds(ev, endT, input.initialStance ?? 'idle');
  return {
    duo: { ...input.duo },
    status,
    activeTimeS: Math.round(endT * 10) / 10,
    distanceM: input.distanceM ?? null,
    stanceSeconds: stance,
    stanceShare: shares(stance),
    noise: { total: noiseTotal, bySource: noiseBy, maxLoudness: maxLoud, heardBySource: heardBy },
    hyde: { alertsByMode: alerts, heard, sightings, chases: alerts.CHASE, catches, blockedCatches: blocked, hpLost, firstAlertT },
    clues: { found, count: found.length, total: input.totalClues ?? 3 },
    egg: {
      pickupT, drops, securityLost: Math.round(securityLost * 10) / 10, security: result ? result.eggSecurity : security,
      delivered, deliveredT, points,
    },
    abilities: { F, Q },
    hints,
    verdict: status === 'finished' ? (result?.verdict ?? verdict) : null,
    extraction: delivered,
    score: status === 'finished' ? (result?.score ?? score) : null,
    hp: result ? result.hp : null,
    catches,
  };
}

/** Report for a live / finished collector. */
export function describeCollector(c: TelemetryCollector, totalClues = 3): SessionReport {
  return describeSession({
    duo: c.meta.duo, events: c.events, initialStance: c.initialStance(), distanceM: c.distanceM, result: c.result,
    factors: c.meta.factors, totalClues, endT: c.result ? c.result.activeTimeS : undefined,
  });
}

// ----------------------------------------------------------------------------------------------------- aggregate

export interface PickRate { id: string; offered: number; selected: number; rate: number | null; smallSample: boolean }

export interface DescriptiveAggregate {
  runs: number;
  finished: number;
  dnf: number;
  inProgress: number;
  caseSolvedPctOfFinished: number | null;
  medianTimeS: number | null; // finishers
  clueFindRate: Record<string, number>; // over ended runs
  allThreePct: number | null;
  detectionsPerRun: number | null; // chase onsets per ended run
  detectionsLast20: number[];
  heardAlerts: number; // investigations started by a heard noise
  seenAlerts: number; // investigations / chases started by sight
  medianFirstAlertS: number | null;
  stanceMix: StanceTimes; // shares over all ended runs
  topAbilities: { key: 'F' | 'Q'; abilityId: string; uses: number; successes: number }[];
  pickRate: { characters: PickRate[]; pokemon: PickRate[] };
  smallSample: boolean;
}

export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Laptop 1 aggregate over many sessions (local collectors or rows rebuilt from Supabase). */
export function aggregateSessions(records: readonly SessionRecord[], clueIds: readonly string[] = []): DescriptiveAggregate {
  const reports = records.map((r) => ({
    r,
    rep: describeSession({
      duo: r.duo ?? { characterId: 'unknown', pokemonId: 'unknown' } as unknown as Duo,
      events: r.events,
      endT: r.result?.activeTimeS,
    }),
  }));
  const ended = reports.filter((x) => x.r.result || x.rep.status !== 'in_progress');
  const outcome = (x: (typeof reports)[number]) => x.r.result?.outcome ?? (x.rep.status === 'in_progress' ? null : x.rep.status);
  const fin = ended.filter((x) => outcome(x) === 'finished');
  const dnf = ended.filter((x) => outcome(x) === 'dnf');
  const solved = fin.filter((x) => (x.r.result?.verdict ?? x.rep.verdict) === 'case_solved');
  const clueSet = new Set<string>(clueIds);
  for (const x of ended) for (const f of x.rep.clues.found) clueSet.add(f.clueId);
  const clueFindRate: Record<string, number> = {};
  for (const id of clueSet) clueFindRate[id] = ended.length ? ended.filter((x) => cluesOf(x).includes(id)).length / ended.length : 0;
  const totalClues = Math.max(3, clueSet.size);
  const stanceSum = zeroRecord(STANCES) as StanceTimes;
  for (const x of ended) for (const s of STANCES) stanceSum[s] += x.rep.stanceSeconds[s];
  const abil = new Map<string, { key: 'F' | 'Q'; abilityId: string; uses: number; successes: number }>();
  let heardAlerts = 0;
  let seenAlerts = 0;
  for (const x of ended) {
    for (const e of x.r.events) {
      if (e.type === 'ability_used') {
        const k = `${e.key}:${e.abilityId}`;
        const a = abil.get(k) ?? { key: e.key, abilityId: e.abilityId, uses: 0, successes: 0 };
        a.uses++;
        if (e.success) a.successes++;
        abil.set(k, a);
      } else if (e.type === 'hyde_mode' && ALERT_MODES.includes(e.to) && e.from !== 'CHASE') {
        if (e.reason === 'heard_noise') heardAlerts++;
        else if (e.reason === 'saw_player') seenAlerts++;
      }
    }
  }
  const pick = pickRates(records);
  const firstAlerts = ended.map((x) => x.rep.hyde.firstAlertT).filter((v): v is number => v !== null);
  return {
    runs: records.length,
    finished: fin.length,
    dnf: dnf.length,
    inProgress: records.length - ended.length,
    caseSolvedPctOfFinished: fin.length ? (100 * solved.length) / fin.length : null,
    medianTimeS: median(fin.map((x) => x.r.result?.activeTimeS ?? x.rep.activeTimeS)),
    clueFindRate,
    allThreePct: ended.length ? (100 * ended.filter((x) => cluesOf(x).length >= totalClues).length) / ended.length : null,
    detectionsPerRun: ended.length ? ended.reduce((s, x) => s + x.rep.hyde.chases, 0) / ended.length : null,
    detectionsLast20: ended.slice(-20).map((x) => x.rep.hyde.chases),
    heardAlerts,
    seenAlerts,
    medianFirstAlertS: median(firstAlerts),
    stanceMix: shares(stanceSum),
    topAbilities: [...abil.values()].sort((a, b) => b.uses - a.uses || a.abilityId.localeCompare(b.abilityId)).slice(0, 5),
    pickRate: pick,
    smallSample: ended.length < 10,
  };
}

function cluesOf(x: { r: SessionRecord; rep: SessionReport }): string[] {
  return x.r.result?.cluesFound ? [...x.r.result.cluesFound] : x.rep.clues.found.map((f) => f.clueId);
}

/** Pick rate when offered = selected ÷ offered, per character and per Pokémon (keys come from the data). */
export function pickRates(records: readonly SessionRecord[]): { characters: PickRate[]; pokemon: PickRate[] } {
  const ch = new Map<string, { offered: number; selected: number }>();
  const pk = new Map<string, { offered: number; selected: number }>();
  const bump = (m: Map<string, { offered: number; selected: number }>, id: string, field: 'offered' | 'selected') => {
    const v = m.get(id) ?? { offered: 0, selected: 0 };
    v[field]++;
    m.set(id, v);
  };
  for (const r of records) {
    if (!r.offered || r.offered.length === 0) continue;
    for (const d of r.offered) {
      bump(ch, d.characterId, 'offered');
      bump(pk, d.pokemonId, 'offered');
    }
    if (r.duo) {
      bump(ch, r.duo.characterId, 'selected');
      bump(pk, r.duo.pokemonId, 'selected');
    }
  }
  const list = (m: Map<string, { offered: number; selected: number }>): PickRate[] =>
    [...m.entries()]
      .map(([id, v]) => ({ id, offered: v.offered, selected: v.selected, rate: v.offered ? v.selected / v.offered : null, smallSample: v.offered < 10 }))
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.offered - a.offered || a.id.localeCompare(b.id));
  return { characters: list(ch), pokemon: list(pk) };
}
